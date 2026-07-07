export function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

export function getBaseUrl() {
  if (isDevelopment()) {
    return process.env.LOCAL_SERVER_URL || 'http://localhost:8080';
  }
  return process.env.APP_BASE_URL;
}

export function getPort() {
  return parseInt(process.env.PORT || '8080', 10);
}
