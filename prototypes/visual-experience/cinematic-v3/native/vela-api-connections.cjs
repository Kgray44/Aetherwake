const CONTRACT = 'aerynth.vela-api-connection@1', PROVIDER = 'openai-api-vela', CONFIGURATION = 'vela-primary';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const version = value => Number.isSafeInteger(value) && value >= 1;
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const safeCodes = new Set(['api_configuration_invalid', 'api_configuration_changed', 'api_configuration_disconnected',
  'api_configuration_limit', 'api_storage_unavailable', 'api_storage_connection_mismatch', 'api_secret_unavailable',
  'api_secret_invalid', 'api_operation_timeout', 'api_connections_closed', 'api_catalog_unavailable',
  'api_catalog_invalid', 'api_catalog_stale', 'api_catalog_busy', 'api_catalog_capacity']);
function safeApiStatus(value) {
  const optional = ['organization', 'project', 'errorCode'].filter(key => Object.hasOwn(value ?? {}, key));
  const required = ['contract', 'providerId', 'billingRoute', 'configurationId', 'version', 'configured', 'state',
    'storageAvailable', 'catalog', 'inferenceVerified', 'entitlement'];
  if (!exact(value, [...required, ...optional]) || value.contract !== CONTRACT || value.providerId !== PROVIDER ||
      value.billingRoute !== 'openai-api' || value.configurationId !== CONFIGURATION ||
      !(value.version === null || version(value.version)) || typeof value.configured !== 'boolean' ||
      !['disconnected', 'configured', 'unavailable'].includes(value.state) || typeof value.storageAvailable !== 'boolean' ||
      value.inferenceVerified !== false || value.entitlement !== 'unverified' ||
      optional.some(key => key === 'errorCode' ? !safeCodes.has(value[key]) : !id(value[key]))) throw Error('api_status_invalid');
  const catalog = value.catalog;
  if (!(exact(catalog, ['state']) && ['not-checked', 'unavailable'].includes(catalog.state)) &&
      !(exact(catalog, ['state', 'observedAt', 'expiresAt', 'modelCount']) && ['ready', 'stale'].includes(catalog.state) &&
        time(catalog.observedAt) && time(catalog.expiresAt) && catalog.expiresAt > catalog.observedAt &&
        Number.isSafeInteger(catalog.modelCount) && catalog.modelCount >= 0 && catalog.modelCount <= 2048)) throw Error('api_status_invalid');
  if (value.configured && value.version === null || value.state === 'configured' && (!value.configured || !value.storageAvailable) ||
      value.state === 'disconnected' && value.configured) throw Error('api_status_invalid');
  return structuredClone(value);
}
function safeApiCatalog(value, expectedVersion) {
  if (!exact(value, ['providerId', 'configurationId', 'version', 'observedAt', 'expiresAt', 'catalogOnly', 'inferenceVerified', 'capabilities', 'models']) ||
      value.providerId !== PROVIDER || value.configurationId !== CONFIGURATION || value.version !== expectedVersion ||
      !time(value.observedAt) || !time(value.expiresAt) || value.expiresAt <= value.observedAt ||
      value.catalogOnly !== true || value.inferenceVerified !== false || value.capabilities !== 'unverified' ||
      !Array.isArray(value.models) || value.models.length > 2048 ||
      !value.models.every(model => exact(model, ['id', 'label']) && id(model.id) && model.label === model.id) ||
      new Set(value.models.map(model => model.id)).size !== value.models.length) throw Error('api_catalog_invalid');
  return structuredClone(value);
}
function createVelaApiConnectionBroker({ call, setup, authorize }) {
  let closed = false, changing = false;
  return {
    async command(input, context) {
      if (closed) throw Error('api_connections_closed');
      const passive = exact(input, ['type']) && input.type === 'status';
      const usageStatus = exact(input, ['type']) && input.type === 'usageStatus';
      const usage = exact(input, ['type', 'expectedVersion', 'enabled']) && input.type === 'authorizeUsage' && version(input.expectedVersion) && typeof input.enabled === 'boolean';
      const entry = exact(input, ['type']) && input.type === 'setup';
      const selected = exact(input, ['type', 'expectedVersion']) && ['catalog', 'disconnect'].includes(input.type) && version(input.expectedVersion);
      if (!passive && !entry && !selected && !usageStatus && !usage) throw Error('api_configuration_invalid');
      if (passive) return safeApiStatus(await call('velaApiConnection', { type: 'status' }));
      if (usageStatus) return safeApiUsage(await call('velaApiUsageStatus', {}));
      if (changing) throw Error('api_catalog_busy');
      changing = true;
      try {
        if (await authorize(context) !== true || closed) throw Error('api_user_gesture_required');
        if (usage) return safeApiUsage(await call('velaApiUsageAuthorize', { expectedVersion: input.expectedVersion, enabled: input.enabled }));
        if (entry) {
          await setup(context);
          if (closed) throw Error('api_connections_closed');
          return safeApiStatus(await call('velaApiConnection', { type: 'status' }));
        }
        const result = await call('velaApiConnection', { type: input.type, expectedVersion: input.expectedVersion });
        if (closed) throw Error('api_connections_closed');
        return input.type === 'catalog' ? safeApiCatalog(result, input.expectedVersion) : safeApiStatus(result);
      } finally { changing = false; }
    },
    close() { closed = true; },
  };
}
function safeApiUsage(value) {
  if (!exact(value, ['enabled','configurationVersion','maxOutputTokens','requestsPerDay','usedToday']) || typeof value.enabled !== 'boolean' ||
      !(value.configurationVersion === null || version(value.configurationVersion)) || value.enabled && value.configurationVersion === null ||
      value.maxOutputTokens !== 2048 || value.requestsPerDay !== 64 || !Number.isSafeInteger(value.usedToday) || value.usedToday < 0)
    throw Error('api_usage_status_invalid');
  return structuredClone(value);
}
module.exports = { createVelaApiConnectionBroker, safeApiStatus, safeApiCatalog, safeApiUsage };
