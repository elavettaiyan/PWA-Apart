# Local Server URLs

## Main Local URLs
- Frontend (Vite): http://localhost:5173
- Backend API: http://localhost:4000
- Backend Health Check: http://localhost:4000/api/health
- API via Frontend Proxy: http://localhost:5173/api
- Uploads via Frontend Proxy: http://localhost:5173/uploads

## Marketing Local URL
- Astro dev server (default): http://localhost:4321

## Notes
- Frontend proxy forwards `/api` and `/uploads` to backend on port 4000.
- If any port is busy, run the service with a different port and update env/config accordingly.


cd /Users/elaa.2484gmail.com/PWA-Apart/packages/server && npx prisma studio