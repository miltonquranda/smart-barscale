import axios from 'axios';

const api = axios.create({
    // Keep the deployed app functional even if the build environment omits
    // VITE_API_URL; Firebase Hosting proxies /api to the API function.
    baseURL: import.meta.env.VITE_API_URL || '/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add a request interceptor to include the token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `token ${token}`;
    }
    return config;
});

// Add a response interceptor to handle auth errors.
//
// Only a 401 means "your session is invalid". A 403 means "you are logged in
// but not allowed to do this" — for example an admin-only route, or a business
// scope the user doesn't own. Treating 403 as a session failure used to log
// users out in a loop: the dashboard would 403, clear the token, redirect to
// login, and repeat. Authorisation failures are surfaced to the caller instead.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

export default api;
