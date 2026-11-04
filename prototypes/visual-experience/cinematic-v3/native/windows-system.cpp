// Fixed, private Electron-main N-API boundary. No renderer entry point or helper-process identity.
#include <windows.h>
#include <objbase.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Devices.Geolocation.h>
#include <string>
#include <chrono>
#include <cstdlib>
#include <cmath>
using namespace winrt::Windows::Devices::Geolocation;
using namespace winrt::Windows::Foundation;
using V=void*; using E=void*; using CB=V(*)(E,V);
// The stable Node-API C ABI is resolved from the hosting executable; no Electron-version import library.
#define API(name, args) using name##_t=int(__cdecl*)args; static name##_t name
API(napi_get_cb_info,(E,V,size_t*,V*,V*,V*));
API(napi_get_value_string_utf8,(E,V,char*,size_t,size_t*));
API(napi_get_value_double,(E,V,double*));
API(napi_create_promise,(E,V*,V*));
API(napi_create_async_work,(E,V,V,void(*)(E,V),void(*)(E,int,V),V,V*));
API(napi_queue_async_work,(E,V)); API(napi_delete_async_work,(E,V));
API(napi_create_string_utf8,(E,const char*,size_t,V*));
API(napi_create_double,(E,double,V*)); API(napi_create_object,(E,V*));
API(napi_set_named_property,(E,V,const char*,V));
API(napi_resolve_deferred,(E,V,V)); API(napi_reject_deferred,(E,V,V));
API(napi_create_function,(E,const char*,size_t,CB,V,V*));
API(napi_throw_error,(E,const char*,const char*));
static void str(E e,V o,const char* k,const std::string& x){V v;napi_create_string_utf8(e,x.c_str(),x.size(),&v);napi_set_named_property(e,o,k,v);}
static void num(E e,V o,const char* k,double x){V v;napi_create_double(e,x,&v);napi_set_named_property(e,o,k,v);}
struct Request { V deferred{},work{}; IAsyncOperation<GeolocationAccessStatus> access{nullptr}; double requestedAt{},lat{},lon{},observedAt{};std::string source,error; };
struct LocationFailure { const char* code; };
static const char* consentDecision(GeolocationAccessStatus status){
 switch(status){case GeolocationAccessStatus::Allowed:return nullptr;case GeolocationAccessStatus::Denied:return "location_os_denied";default:return "location_permission_unspecified";}
}
static const char* locationError(winrt::hresult code,const char* fallback){
 if(code==E_ACCESSDENIED)return "location_os_denied";
 if(code==HRESULT_FROM_WIN32(ERROR_CANCELLED)||code==E_ABORT)return "location_cancelled";
 return fallback;
}
template<typename Operation> static auto completedLocationOperation(const Operation& operation,std::chrono::seconds timeout,const char* timeoutCode){
 auto status=operation.wait_for(timeout);
 if(status==AsyncStatus::Started){try{operation.Cancel();}catch(...){}throw LocationFailure{timeoutCode};}
 if(status==AsyncStatus::Canceled)throw LocationFailure{"location_cancelled"};
 // Error is terminal too: GetResults rethrows its real HRESULT instead of claiming a timeout.
 return operation.GetResults();
}
static void execute(E,V data){
 auto& r=*static_cast<Request*>(data);
 const char* unavailable="location_native_consent_unavailable";
 try{
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  struct ApartmentExit { ~ApartmentExit(){winrt::uninit_apartment();} } apartmentExit;
   auto access=completedLocationOperation(r.access,std::chrono::seconds(25),"location_permission_timeout");
   if(auto error=consentDecision(access)){r.error=error;return;}
   unavailable="location_fresh_fix_unavailable";
  Geolocator locator;locator.DesiredAccuracy(PositionAccuracy::Default);
  auto operation=locator.GetGeopositionAsync(std::chrono::seconds(0),std::chrono::seconds(12));
   auto coordinate=completedLocationOperation(operation,std::chrono::seconds(14),"location_fresh_fix_unavailable").Coordinate();auto position=coordinate.Point().Position();
  r.lat=position.Latitude;r.lon=position.Longitude;
  r.observedAt=std::chrono::duration<double,std::milli>(coordinate.Timestamp().time_since_epoch()).count()-11644473600000.0;
  switch(coordinate.PositionSource()){
   case PositionSource::Satellite:r.source="satellite";break;
   case PositionSource::Cellular:r.source="cellular";break;
   case PositionSource::WiFi:r.source="wifi";break;
   default:r.error="location_source_unavailable";return;
  }
  if(!std::isfinite(r.lat)||!std::isfinite(r.lon)||std::abs(r.lat)>90||std::abs(r.lon)>180||r.observedAt<r.requestedAt)r.error="location_stale_fix";
  }catch(const LocationFailure& ex){r.error=ex.code;}
  catch(const winrt::hresult_error& ex){r.error=locationError(ex.code(),unavailable);}
  catch(...){r.error=unavailable;}
}
static void complete(E e,int status,V data){
 auto r=static_cast<Request*>(data);V result;
 if(status||!r->error.empty()){auto error=r->error.empty()?"location_cancelled":r->error;napi_create_string_utf8(e,error.c_str(),error.size(),&result);napi_reject_deferred(e,r->deferred,result);}
 else{napi_create_object(e,&result);num(e,result,"latitude",r->lat);num(e,result,"longitude",r->lon);num(e,result,"observedAtMs",r->observedAt);str(e,result,"source",r->source);napi_resolve_deferred(e,r->deferred,result);}
 napi_delete_async_work(e,r->work);delete r;
}
static V locate(E e,V info){
 size_t count=2;V args[2];napi_get_cb_info(e,info,&count,args,nullptr,nullptr);
 char window[32]{};size_t length=0;double requestedAt=0;
 if(count!=2||napi_get_value_string_utf8(e,args[0],window,sizeof(window),&length)||!length||length>=sizeof(window)||napi_get_value_double(e,args[1],&requestedAt)||!std::isfinite(requestedAt)){
  napi_throw_error(e,nullptr,"location_native_arguments");return nullptr;
 }
 char* end{};auto owner=reinterpret_cast<HWND>(std::strtoull(window,&end,16));DWORD pid=0;DWORD thread=GetWindowThreadProcessId(owner,&pid);
 APTTYPE apartment;APTTYPEQUALIFIER qualifier;
 if(*end||!owner||!IsWindow(owner)||pid!=GetCurrentProcessId()||thread!=GetCurrentThreadId()||GetForegroundWindow()!=owner||FAILED(CoGetApartmentType(&apartment,&qualifier))||(apartment!=APTTYPE_STA&&apartment!=APTTYPE_MAINSTA)){
  napi_throw_error(e,nullptr,"location_foreground_ui_required");return nullptr;
 }
 auto r=new Request;r->requestedAt=requestedAt;
 try{r->access=Geolocator::RequestAccessAsync();}catch(const winrt::hresult_error& ex){auto code=locationError(ex.code(),"location_native_consent_unavailable");delete r;napi_throw_error(e,nullptr,code);return nullptr;}catch(...){delete r;napi_throw_error(e,nullptr,"location_native_consent_unavailable");return nullptr;}
 V promise,name;napi_create_promise(e,&r->deferred,&promise);napi_create_string_utf8(e,"aerynth-current-windows-location",32,&name);
 if(napi_create_async_work(e,nullptr,name,execute,complete,r,&r->work)||napi_queue_async_work(e,r->work)){delete r;napi_throw_error(e,nullptr,"location_native_unavailable");return nullptr;}
 return promise;
}
static V battery(E e,V){
 SYSTEM_POWER_STATUS p{};if(!GetSystemPowerStatus(&p)){napi_throw_error(e,nullptr,"local_system_battery_unavailable");return nullptr;}
 V o;napi_create_object(e,&o);num(e,o,"acLineStatus",p.ACLineStatus);num(e,o,"batteryFlag",p.BatteryFlag);num(e,o,"batteryLifePercent",p.BatteryLifePercent);num(e,o,"batteryLifeSeconds",p.BatteryLifeTime);return o;
}
extern "C" __declspec(dllexport) V napi_register_module_v1(E e,V exports){
 auto host=GetModuleHandleW(nullptr);
#define LOAD(name) name=reinterpret_cast<name##_t>(GetProcAddress(host,#name));if(!name)return nullptr
 LOAD(napi_get_cb_info);LOAD(napi_get_value_string_utf8);LOAD(napi_get_value_double);LOAD(napi_create_promise);LOAD(napi_create_async_work);LOAD(napi_queue_async_work);LOAD(napi_delete_async_work);LOAD(napi_create_string_utf8);LOAD(napi_create_double);LOAD(napi_create_object);LOAD(napi_set_named_property);LOAD(napi_resolve_deferred);LOAD(napi_reject_deferred);LOAD(napi_create_function);LOAD(napi_throw_error);
 V f;napi_create_function(e,"locate",6,locate,nullptr,&f);napi_set_named_property(e,exports,"locate",f);napi_create_function(e,"battery",7,battery,nullptr,&f);napi_set_named_property(e,exports,"battery",f);return exports;
}
