const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, { method = "GET", body, headers = {}, token, ...rest } = {}) {
  const config = { method, headers: { ...headers }, ...rest };

  const isFormData = body instanceof FormData;
  if (body && !isFormData) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(body);
  } else if (body) {
    config.body = body;
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, config);
  const contentType = response.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const message = typeof data === "string" && data.trim().length > 0 ? data : data?.detail || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

export { API_BASE_URL, request };
export default request;
