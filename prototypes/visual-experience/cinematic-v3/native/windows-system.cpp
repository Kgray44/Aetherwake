// Fixed, private Electron-main N-API boundary. No renderer entry point or helper-process identity.
#include <windows.h>
#include <objbase.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Devices.Geolocation.h>
#include <string>
#include <chrono>
#include <cstdlib>
#include <cmath>
#include <psapi.h>
#include <sddl.h>
#include <memory>
#include <mutex>
#include <atomic>
#include <unordered_map>
#include <vector>
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <stdexcept>
using namespace winrt::Windows::Devices::Geolocation;
using winrt::Windows::Foundation::IAsyncOperation;
using winrt::Windows::Foundation::AsyncStatus;
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
// Memory maintenance is private native authority. The broker supplies exact
// reviewed selection/idle attestation; this layer independently fences identity,
// current-user/session, protected/system/foreground processes and revocation.
namespace memory_host {
static std::atomic<unsigned long long> epoch{1};static std::atomic<unsigned> pending{0};static std::atomic<bool> trimming{false};
struct Handle {HANDLE value{};explicit Handle(HANDLE h=nullptr):value(h){}~Handle(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);}Handle(const Handle&)=delete;};
static std::string utf8(const std::wstring& s){if(s.empty())return {};int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),int(s.size()),nullptr,0,nullptr,nullptr);if(n<=0)throw std::runtime_error("memory_native_protocol");std::string r(n,0);WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),int(s.size()),r.data(),n,nullptr,nullptr);return r;}
static std::string quote(const std::string& s){std::string r="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){r+='\\';r+=c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);r+=b;}else r+=c;}return r+'"';}
static std::string hex64(unsigned long long n){std::ostringstream o;o<<std::hex<<std::setfill('0')<<std::setw(16)<<n;return o.str();}
static unsigned long long ticks(FILETIME t){ULARGE_INTEGER n;n.LowPart=t.dwLowDateTime;n.HighPart=t.dwHighDateTime;return n.QuadPart;}
static std::string guid(){GUID g;if(FAILED(CoCreateGuid(&g)))throw std::runtime_error("memory_native_unavailable");wchar_t s[40];StringFromGUID2(g,s,40);std::wstring w(s+1,36);for(auto& c:w)c=towlower(c);return utf8(w);}
static unsigned long long bytes(SIZE_T pages,SIZE_T pageSize){if(pageSize&&pages>9007199254740991ULL/pageSize)throw std::runtime_error("memory_native_protocol");return static_cast<unsigned long long>(pages)*pageSize;}
struct Snapshot {unsigned long long total{},available{},commit{},limit{},cache{},duration{};int low=-1;std::string json()const{return "{\"physicalTotalBytes\":"+std::to_string(total)+",\"physicalAvailableBytes\":"+std::to_string(available)+",\"systemCommitBytes\":"+std::to_string(commit)+",\"systemCommitLimitBytes\":"+std::to_string(limit)+",\"systemCommitHeadroomBytes\":"+std::to_string(limit-commit)+",\"systemCacheBytes\":"+std::to_string(cache)+",\"sampleDurationMs\":"+std::to_string(duration)+",\"lowMemoryNotification\":"+(low<0?"null":low?"true":"false")+"}";}};
static Snapshot snapshot(){auto start=GetTickCount64();MEMORYSTATUSEX m{};m.dwLength=sizeof(m);PERFORMANCE_INFORMATION p{};p.cb=sizeof(p);if(!GlobalMemoryStatusEx(&m)||!K32GetPerformanceInfo(&p,sizeof(p)))throw std::runtime_error("memory_measurement_unavailable");Snapshot s;s.total=m.ullTotalPhys;s.available=m.ullAvailPhys;s.commit=bytes(p.CommitTotal,p.PageSize);s.limit=bytes(p.CommitLimit,p.PageSize);s.cache=bytes(p.SystemCache,p.PageSize);Handle event(CreateMemoryResourceNotification(LowMemoryResourceNotification));BOOL low;if(event.value&&QueryMemoryResourceNotification(event.value,&low))s.low=low?1:0;s.duration=GetTickCount64()-start;if(s.total>9007199254740991ULL||s.available>s.total||s.commit>s.limit||!s.limit||s.duration>5000)throw std::runtime_error("memory_native_protocol");return s;}
static std::wstring sid(HANDLE process){HANDLE raw{};if(!OpenProcessToken(process,TOKEN_QUERY,&raw))throw std::runtime_error("memory_target_ineligible");Handle token(raw);DWORD needed=0;GetTokenInformation(token.value,TokenUser,nullptr,0,&needed);if(!needed||needed>4096)throw std::runtime_error("memory_target_ineligible");std::vector<unsigned char> b(needed);if(!GetTokenInformation(token.value,TokenUser,b.data(),needed,&needed))throw std::runtime_error("memory_target_ineligible");LPWSTR text{};if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(b.data())->User.Sid,&text))throw std::runtime_error("memory_target_ineligible");std::wstring result(text);LocalFree(text);return result;}
struct Identity {DWORD pid{},session{};unsigned long long creation{},cpu{},sampleTick{};std::wstring user,image;int critical=-1,protection=-1;bool system=false,foreground=false,excluded=false;std::string json()const{return "{\"pid\":"+std::to_string(pid)+",\"creation\":"+quote(hex64(creation))+",\"session\":"+std::to_string(session)+",\"sid\":"+quote(utf8(user))+",\"image\":"+quote(utf8(image))+"}";}};
static bool prefix(const std::wstring& value,const std::wstring& base){return value.size()>base.size()&&CompareStringOrdinal(value.data(),int(base.size()),base.data(),int(base.size()),TRUE)==CSTR_EQUAL&&(value[base.size()]=='\\'||value[base.size()]=='/');}
static bool aerynthImage(const std::wstring& image){wchar_t self[4096];DWORD size=GetModuleFileNameW(nullptr,self,4096);if(!size||size>=4096)return true;if(CompareStringOrdinal(image.c_str(),-1,self,-1,TRUE)==CSTR_EQUAL)return true;auto slash=image.find_last_of(L"\\/");auto leaf=slash==std::wstring::npos?image:image.substr(slash+1);for(auto& c:leaf)c=towlower(c);if(leaf==L"aerynthreview.exe"||leaf==L"aerynth.exe")return true;if(leaf==L"node.exe"&&slash!=std::wstring::npos){auto parent=image.substr(0,slash);auto vendor=parent.find_last_of(L"\\/");if(vendor!=std::wstring::npos&&CompareStringOrdinal(parent.substr(vendor+1).c_str(),-1,L"vendor",-1,TRUE)==CSTR_EQUAL){auto app=parent.substr(0,vendor)+L"\\AerynthReview.exe";if(GetFileAttributesW(app.c_str())!=INVALID_FILE_ATTRIBUTES)return true;}}return false;}
static Identity identify(HANDLE h,const std::vector<DWORD>& excluded){Identity i;i.pid=GetProcessId(h);FILETIME c,e,k,u;if(!i.pid||!GetProcessTimes(h,&c,&e,&k,&u)||!ProcessIdToSessionId(i.pid,&i.session))throw std::runtime_error("memory_identity_changed");i.creation=ticks(c);i.cpu=ticks(k)+ticks(u);i.sampleTick=GetTickCount64();i.user=sid(h);wchar_t image[4096];DWORD size=4096;if(!QueryFullProcessImageNameW(h,0,image,&size))throw std::runtime_error("memory_target_ineligible");i.image.assign(image,size);BOOL critical;using Crit=BOOL(WINAPI*)(HANDLE,PBOOL);auto criticalFn=reinterpret_cast<Crit>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"IsProcessCritical"));if(criticalFn&&criticalFn(h,&critical))i.critical=critical?1:0;using Info=BOOL(WINAPI*)(HANDLE,PROCESS_INFORMATION_CLASS,LPVOID,DWORD);auto infoFn=reinterpret_cast<Info>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"GetProcessInformation"));PROCESS_PROTECTION_LEVEL_INFORMATION protection{};if(infoFn&&infoFn(h,ProcessProtectionLevelInfo,&protection,sizeof(protection)))i.protection=protection.ProtectionLevel==PROTECTION_LEVEL_NONE?0:1;DWORD foreground=0,shell=0;GetWindowThreadProcessId(GetForegroundWindow(),&foreground);GetWindowThreadProcessId(GetShellWindow(),&shell);i.foreground=i.pid==foreground;wchar_t windows[4096];UINT n=GetWindowsDirectoryW(windows,4096);i.system=i.pid==shell||!n||n>=4096||prefix(i.image,std::wstring(windows,n));i.excluded=aerynthImage(i.image)||i.pid==GetCurrentProcessId()||std::find(excluded.begin(),excluded.end(),i.pid)!=excluded.end();return i;}
static std::string cpuSample(const Identity& first,HANDLE h){FILETIME c,e,k,u;auto now=GetTickCount64();DWORD count=GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);if(!count||!GetProcessTimes(h,&c,&e,&k,&u)||ticks(c)!=first.creation||now<first.sampleTick+200||now>first.sampleTick+5000)return "null";auto next=ticks(k)+ticks(u);if(next<first.cpu)return "null";auto duration=now-first.sampleTick;double percent=100.0*double(next-first.cpu)/(double(duration)*10000.0*count);if(!std::isfinite(percent)||percent<0||percent>100)return "null";std::ostringstream out;out<<"{\"percent\":"<<std::setprecision(8)<<percent<<",\"sampleMs\":"<<duration<<",\"logicalProcessors\":"<<count<<"}";return out.str();}
static bool equal(const Identity&a,const Identity&b){return a.pid==b.pid&&a.creation==b.creation&&a.session==b.session&&a.user==b.user&&CompareStringOrdinal(a.image.c_str(),-1,b.image.c_str(),-1,TRUE)==CSTR_EQUAL;}
struct Lease {Handle handle;Identity identity;std::string ref;unsigned long long expires{},epoch{};SIZE_T workingSet{},privateCommit{};Lease(HANDLE h):handle(h){}};
static std::mutex leasesMutex;static std::unordered_map<std::string,std::shared_ptr<Lease>> leases;
static void purge(){auto now=GetTickCount64();for(auto it=leases.begin();it!=leases.end();)if(it->second->expires<now||it->second->epoch!=epoch.load())it=leases.erase(it);else ++it;}
static std::vector<DWORD> excluded(const std::string& text){std::vector<DWORD> r;if(text.empty())return r;std::istringstream in(text);std::string item;while(std::getline(in,item,',')){if(r.size()>=64||item.empty()||item.size()>10||item.find_first_not_of("0123456789")!=std::string::npos)throw std::runtime_error("memory_native_protocol");auto n=std::stoull(item);if(!n||n>MAXDWORD)throw std::runtime_error("memory_native_protocol");r.push_back(DWORD(n));}return r;}
static std::string inspect(unsigned limit,const std::vector<DWORD>& denied,unsigned long long generation){DWORD ids[1024],needed=0;if(!K32EnumProcesses(ids,sizeof(ids),&needed))throw std::runtime_error("memory_native_unavailable");DWORD selfSession;if(!ProcessIdToSessionId(GetCurrentProcessId(),&selfSession))throw std::runtime_error("memory_native_unavailable");auto selfSid=sid(GetCurrentProcess());unsigned scanned=0,unavailable=0;bool partial=needed>=sizeof(ids);auto start=GetTickCount64();std::vector<std::shared_ptr<Lease>> rows;for(unsigned index=0;index<std::min<unsigned>(needed/sizeof(DWORD),1024);index++){if(epoch.load()!=generation)throw std::runtime_error("memory_permission_revoked");if(GetTickCount64()-start>1000){partial=true;break;}DWORD pid=ids[index];if(!pid)continue;scanned++;Handle h(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid));if(!h.value){unavailable++;continue;}try{auto i=identify(h.value,denied);if(i.user!=selfSid||i.session!=selfSession)continue;PROCESS_MEMORY_COUNTERS_EX counters{};if(!K32GetProcessMemoryInfo(h.value,reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&counters),sizeof(counters))){unavailable++;continue;}auto lease=std::make_shared<Lease>(h.value);h.value=nullptr;lease->identity=i;lease->workingSet=counters.WorkingSetSize;lease->privateCommit=counters.PrivateUsage;lease->ref=guid();lease->expires=GetTickCount64()+30000;lease->epoch=generation;rows.push_back(lease);}catch(...){unavailable++;}}
std::sort(rows.begin(),rows.end(),[](const auto&a,const auto&b){return a->workingSet==b->workingSet?a->identity.pid<b->identity.pid:a->workingSet>b->workingSet;});if(rows.size()>limit){partial=true;rows.resize(limit);}Sleep(200);if(epoch.load()!=generation)throw std::runtime_error("memory_permission_revoked");std::string out="{\"generation\":"+std::to_string(generation)+",\"scanned\":"+std::to_string(scanned)+",\"unavailable\":"+std::to_string(unavailable)+",\"partial\":"+(partial?"true":"false")+",\"processes\":[";bool first=true;std::lock_guard<std::mutex> lock(leasesMutex);purge();for(const auto& lease:rows){if(leases.size()>=64)throw std::runtime_error("memory_native_capacity");PROCESS_MEMORY_COUNTERS_EX c{};if(!K32GetProcessMemoryInfo(lease->handle.value,reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&c),sizeof(c)))continue;auto&i=lease->identity;auto cpu=cpuSample(i,lease->handle.value);auto slash=i.image.find_last_of(L"\\/");auto name=slash==std::wstring::npos?i.image:i.image.substr(slash+1);if(name.size()>128)name.resize(128);if(!first)out+=",";first=false;out+="{\"ref\":"+quote(lease->ref)+",\"identity\":"+i.json()+",\"name\":"+quote(utf8(name))+",\"critical\":"+(i.critical<0?"null":i.critical?"true":"false")+",\"protection\":"+quote(i.protection<0?"unknown":i.protection?"protected":"none")+",\"system\":"+(i.system?"true":"false")+",\"foreground\":"+(i.foreground?"true":"false")+",\"excluded\":"+(i.excluded?"true":"false")+",\"workingSetBytes\":"+std::to_string(c.WorkingSetSize)+",\"privateCommitBytes\":"+std::to_string(c.PrivateUsage)+",\"cpu\":"+cpu+"}";leases[lease->ref]=lease;}out+="]}";if(out.size()>131072)throw std::runtime_error("memory_native_capacity");return out;}
static std::string reclaim(const std::string& ref,HWND owner,const std::vector<DWORD>& denied,unsigned long long generation){std::shared_ptr<Lease> lease;{std::lock_guard<std::mutex> lock(leasesMutex);purge();auto it=leases.find(ref);if(it==leases.end())throw std::runtime_error("memory_snapshot_expired");lease=it->second;leases.erase(it);}if(generation!=epoch.load()||lease->epoch!=generation)throw std::runtime_error("memory_permission_revoked");DWORD ownerPid=0;GetWindowThreadProcessId(owner,&ownerPid);if(!IsWindow(owner)||ownerPid!=GetCurrentProcessId()||GetForegroundWindow()!=owner)throw std::runtime_error("memory_foreground_required");if(WaitForSingleObject(lease->handle.value,0)!=WAIT_TIMEOUT)throw std::runtime_error("memory_identity_changed");Handle h(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_SET_QUOTA|SYNCHRONIZE,FALSE,lease->identity.pid));if(!h.value)throw std::runtime_error("memory_target_ineligible");auto i=identify(h.value,denied);DWORD session;ProcessIdToSessionId(GetCurrentProcessId(),&session);if(!equal(i,lease->identity))throw std::runtime_error("memory_identity_changed");if(i.user!=sid(GetCurrentProcess())||i.session!=session||i.critical!=0||i.protection!=0||i.system||i.foreground||i.excluded)throw std::runtime_error("memory_target_ineligible");if(i.cpu>lease->identity.cpu+500000ULL)throw std::runtime_error("memory_target_ineligible");PROCESS_MEMORY_COUNTERS_EX before{};if(!K32GetProcessMemoryInfo(h.value,reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&before),sizeof(before)))throw std::runtime_error("memory_measurement_unavailable");auto beforeSystem=snapshot();if(generation!=epoch.load())throw std::runtime_error("memory_permission_revoked");if(GetForegroundWindow()!=owner||WaitForSingleObject(h.value,0)!=WAIT_TIMEOUT)throw std::runtime_error("memory_foreground_required");BOOL success;{std::lock_guard<std::mutex> dispatch(leasesMutex);if(generation!=epoch.load())throw std::runtime_error("memory_permission_revoked");success=K32EmptyWorkingSet(h.value);}PROCESS_MEMORY_COUNTERS_EX after{};bool measured=K32GetProcessMemoryInfo(h.value,reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&after),sizeof(after))!=FALSE;std::string afterSystem="null";try{afterSystem=snapshot().json();}catch(...){}return "{\"nativeCallSucceeded\":"+std::string(success?"true":"false")+",\"revokedAfterDispatch\":"+(generation!=epoch.load()?"true":"false")+",\"identity\":"+i.json()+",\"before\":"+beforeSystem.json()+",\"after\":"+afterSystem+",\"workingSetBeforeBytes\":"+std::to_string(before.WorkingSetSize)+",\"workingSetAfterBytes\":"+(measured?std::to_string(after.WorkingSetSize):"null")+",\"privateCommitBeforeBytes\":"+std::to_string(before.PrivateUsage)+",\"privateCommitAfterBytes\":"+(measured?std::to_string(after.PrivateUsage):"null")+"}";}
struct Job {V deferred{},work{};int kind{};unsigned limit{};std::string ref,denied,result,error;HWND owner{};unsigned long long generation{};};
static void executeJob(E,V data){auto& j=*static_cast<Job*>(data);try{if(j.generation!=epoch.load())throw std::runtime_error("memory_permission_revoked");j.result=j.kind==0?snapshot().json():j.kind==1?inspect(j.limit,excluded(j.denied),j.generation):reclaim(j.ref,j.owner,excluded(j.denied),j.generation);}catch(const std::exception& e){j.error=e.what();}catch(...){j.error="memory_native_unavailable";}}
static void completeJob(E e,int status,V data){auto j=static_cast<Job*>(data);if(j->kind<2&&j->generation!=epoch.load())j->error="memory_permission_revoked";V value;if(status||!j->error.empty()){auto error=j->error.empty()?"memory_cancelled":j->error;napi_create_string_utf8(e,error.c_str(),error.size(),&value);napi_reject_deferred(e,j->deferred,value);}else{napi_create_string_utf8(e,j->result.c_str(),j->result.size(),&value);napi_resolve_deferred(e,j->deferred,value);}if(j->kind==2)trimming=false;pending--;{std::unique_lock<std::mutex> lock(leasesMutex,std::try_to_lock);if(lock.owns_lock())purge();}napi_delete_async_work(e,j->work);delete j;}
static bool text(E e,V value,std::string& out,size_t maximum){size_t needed=0;if(napi_get_value_string_utf8(e,value,nullptr,0,&needed)||needed>maximum)return false;std::vector<char> b(needed+1);size_t n=0;if(napi_get_value_string_utf8(e,value,b.data(),b.size(),&n)||n!=needed)return false;out.assign(b.data(),n);return true;}
static V queue(E e,Job* j){if(pending.fetch_add(1)>=2){pending--;delete j;napi_throw_error(e,nullptr,"memory_native_capacity");return nullptr;}if(j->kind==2&&trimming.exchange(true)){pending--;delete j;napi_throw_error(e,nullptr,"memory_native_busy");return nullptr;}V promise,name;napi_create_promise(e,&j->deferred,&promise);napi_create_string_utf8(e,"aerynth-windows-memory",22,&name);if(napi_create_async_work(e,nullptr,name,executeJob,completeJob,j,&j->work)||napi_queue_async_work(e,j->work)){if(j->kind==2)trimming=false;pending--;if(j->work)napi_delete_async_work(e,j->work);delete j;napi_throw_error(e,nullptr,"memory_native_unavailable");return nullptr;}return promise;}
static V memorySnapshot(E e,V){auto j=new Job;j->generation=epoch.load();return queue(e,j);}
static V memoryInspect(E e,V info){size_t count=2;V args[2];double limit=0;std::string denied;napi_get_cb_info(e,info,&count,args,nullptr,nullptr);if(count!=2||napi_get_value_double(e,args[0],&limit)||limit<1||limit>16||std::floor(limit)!=limit||!text(e,args[1],denied,704)){napi_throw_error(e,nullptr,"memory_native_protocol");return nullptr;}auto j=new Job;j->kind=1;j->limit=unsigned(limit);j->denied=denied;j->generation=epoch.load();return queue(e,j);}
static V memoryReclaim(E e,V info){size_t count=4;V args[4];double generation=0;std::string ref,window,denied;napi_get_cb_info(e,info,&count,args,nullptr,nullptr);if(count!=4||!text(e,args[0],ref,36)||ref.size()!=36||!text(e,args[1],window,16)||window.empty()||window.find_first_not_of("0123456789abcdefABCDEF")!=std::string::npos||!text(e,args[2],denied,704)||napi_get_value_double(e,args[3],&generation)||!std::isfinite(generation)||generation<1||std::floor(generation)!=generation||generation>9007199254740991.0){napi_throw_error(e,nullptr,"memory_native_protocol");return nullptr;}auto j=new Job;j->kind=2;j->ref=ref;j->owner=reinterpret_cast<HWND>(std::strtoull(window.c_str(),nullptr,16));j->denied=denied;j->generation=static_cast<unsigned long long>(generation);return queue(e,j);}
static V memoryRevoke(E e,V){epoch++;{std::unique_lock<std::mutex> lock(leasesMutex,std::try_to_lock);if(lock.owns_lock())purge();}V o;napi_create_object(e,&o);return o;}
}
#include "windows-computer.inc"
extern "C" __declspec(dllexport) V napi_register_module_v1(E e,V exports){
 auto host=GetModuleHandleW(nullptr);
#define LOAD(name) name=reinterpret_cast<name##_t>(GetProcAddress(host,#name));if(!name)return nullptr
 LOAD(napi_get_cb_info);LOAD(napi_get_value_string_utf8);LOAD(napi_get_value_double);LOAD(napi_create_promise);LOAD(napi_create_async_work);LOAD(napi_queue_async_work);LOAD(napi_delete_async_work);LOAD(napi_create_string_utf8);LOAD(napi_create_double);LOAD(napi_create_object);LOAD(napi_set_named_property);LOAD(napi_resolve_deferred);LOAD(napi_reject_deferred);LOAD(napi_create_function);LOAD(napi_throw_error);
 V f;napi_create_function(e,"locate",6,locate,nullptr,&f);napi_set_named_property(e,exports,"locate",f);napi_create_function(e,"battery",7,battery,nullptr,&f);napi_set_named_property(e,exports,"battery",f);
 napi_create_function(e,"memorySnapshot",14,memory_host::memorySnapshot,nullptr,&f);napi_set_named_property(e,exports,"memorySnapshot",f);napi_create_function(e,"memoryInspect",13,memory_host::memoryInspect,nullptr,&f);napi_set_named_property(e,exports,"memoryInspect",f);napi_create_function(e,"memoryReclaim",13,memory_host::memoryReclaim,nullptr,&f);napi_set_named_property(e,exports,"memoryReclaim",f);napi_create_function(e,"memoryRevoke",12,memory_host::memoryRevoke,nullptr,&f);napi_set_named_property(e,exports,"memoryRevoke",f);registerComputer(e,exports);return exports;
}
