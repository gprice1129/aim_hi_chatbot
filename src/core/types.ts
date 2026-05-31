export type {
  APIKey,
  BaseURL,
  Endpoint,
}

type APIKey = string;
type BaseURL = string;

interface Endpoint {
  api_key: APIKey;
  base_url: BaseURL;
}
