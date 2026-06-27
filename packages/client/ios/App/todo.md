The only upgrades I’d seriously consider are:

Improve backend architecture before it grows too much
Keep Express if it is working, but organize modules, services, validation, permissions, and error handling very cleanly. A messy Express backend is the main long-term risk.

Keep Capacitor unless mobile limitations become real
If users mostly need forms, dashboards, billing, complaints, notices, staff, approvals, and notifications, Capacitor is fine. Move to React Native only if the mobile UX becomes a strategic differentiator.

Strengthen testing and type contracts
Add stronger API contract validation, integration tests, and permission tests. For this kind of app, role/permission bugs are more dangerous than framework choice.

Consider Drizzle only for future projects
Prisma is still a strong choice. I would not migrate away unless query performance or migration control becomes a real pain.