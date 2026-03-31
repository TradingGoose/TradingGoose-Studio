<h1 align="center">TradingGoose Studio</h1>
<p align="center">
  <b>AI Workflow Platform for Tecnical LLM Trading</b>
</p>


<p align='center'>
  <a href="https://discord.gg/wavf5JWhuT" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align='center'>
  <a href="https://google.com/ai?q=I+am+using+TradingGoose-Studio+from+https%3A%2F%2Fgithub.com%2FTradingGoose%2FTradingGoose-Studio.+How+do+I+automate+a+strategy+using+this+library" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/ASK%20google%20gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white" alt="Gemini"></a>
<a href="https://perplexity.ai?q=I+am+using+TradingGoose-Studio+from+https%3A%2F%2Fgithub.com%2FTradingGoose%2FTradingGoose-Studio.+How+do+I+automate+a+strategy+using+this+library" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/ASK%20perplexity-088F8F?style=for-the-badge&logo=perplexity&logoColor=000000" alt="Perplexity"></a>
</p>

<picture>
  <!-- Image for Light Mode -->
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/f0c8a9b5-4496-440d-9164-4444bbca9eb0">
  <!-- Image for Dark Mode -->
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/bdde59b2-b70b-4e66-8e0b-aaa0c79bdf0b">
  <!-- Fallback Image (shown if the browser doesn't support themes) -->
  <img alt="Project Screenshot" src="https://github.com/user-attachments/assets/f0c8a9b5-4496-440d-9164-4444bbca9eb0" width="2559">
</picture>

---

## What is TradingGoose Studio?

TradingGoose Studio is an **AI workflow platform for technical LLM trading**, it combines both technical + LLM analysis for your trading decision.
It is built for analytics, research, charting, monitoring, and workflow automation. 



<picture>
  <!-- Image for Dark Mode -->
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/d6fe11eb-a9fe-4e76-8ab4-eae6fc21d236">
  <!-- Image for Light Mode -->
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/fed1b97b-336d-4812-8b6c-ffd99f385218">
  <!-- Fallback Image (Defaults to Light) -->
  <img alt="Project Overview" src="https://github.com/user-attachments/assets/fed1b97b-336d-4812-8b6c-ffd99f385218" width="2559">
</picture>



## Quick Start

### Requirements

- **Bun** v1.2+
- **Docker** (for PostgreSQL)
- **Colima** or **Docker Desktop** (macOS)

### Setup Steps

#### 1. Install dependencies
```
bun install
```

#### 2. Start PostgreSQL database
```
docker run --name tradinggoose-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tradinggoose \
  -p 5432:5432 -d \
  pgvector/pgvector:pg17
```
#### 3. Setup environment variables
```
cd apps/tradinggoose && cp .env.example .env
cd ../../packages/db && cp .env.example .env
```
#### Edit .env files (see configuration below)

#### 4. Run database migrations
```
cd packages/db
bunx drizzle-kit migrate --config=./drizzle.config.ts
```
#### 5. Start development servers
```
cd ../..
bun run dev:full
```
| Tech Stack       |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework        | <a href="https://nextjs.org/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.JS"></a>                                                                                                                                                                                                                                |
| Runtime          | <a href="https://bun.sh/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun"></a>                                                                                                                                                                                                                                     |
| Database         | <a href="https://www.postgresql.org/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Postgres-black?style=for-the-badge&logo=postgresql&logoColor=blue" alt="Postgres"></a> <a href="https://orm.drizzle.team" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Drizzle-%23000000?style=for-the-badge&logo=drizzle&logoColor=C5F74F" alt="Drizzle ORM"></a> |
| Authentication   | <a href="https://better-auth.com" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Better%20Auth-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij4KCTxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xMi4xIDEwLjM2aDMuMDV2My4zMkgxMi4xeiIgLz4KCTxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zIDN2MThoMThWM3ptMTUuNDggMTAuNjh2M0gxMi4xdi0zSDguNjJ2M0g1LjQ5VjcuMzZoMy4xM3YzaDMuNDh2LTNoNi4zOHoiIC8+Cjwvc3ZnPg==&logoColor=white" alt="Better Auth"></a>                                                                                                                                                                                                                                            |
| UI               | <a href="https://ui.shadcn.com/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/shadcn-black?style=for-the-badge&logo=shadcnui&logoColor=white" alt="Shadcn"></a> <a href="https://tailwindcss.com" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/TailwindCSS-black?style=for-the-badge&logo=tailwind-css&logoColor=38B2AC" alt="Tailwind CSS"></a>      |
| State Management | <a href="https://zustand-demo.pmnd.rs/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Z%20Zustand-black?style=for-the-badge" alt="Zustand"></a>                                                                                                                                                                                                                                                |
| Realtime         | <a href="https://socket.io/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io" alt="Socket.io"></a> <a href="https://github.com/yjs/yjs" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/y%20js-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDE1LjAyNCAxNy43OTYiPjxwYXRoIGQ9Ik0xOTUuMjk3IDE4NC41MzdjLS43Ny4wMDgtMS4zMTkuMzg4LTEuNjUgMS4xNGwtMi4zNzkgNS41NHYuMDIybDEuNzI3IDIuNTkyIDMuOTE0LTYuNzE1Yy4zMjMtLjU1NC4zMDYtMS4xMjQtLjA1LTEuNzExLS4zNTUtLjU3OS0uODY4LS44NjgtMS41MzctLjg2OHoiIHN0eWxlPSJmb250LXN0eWxlOm5vcm1hbDtmb250LXdlaWdodDo0MDA7Zm9udC1zaXplOjEwLjU4MzMzMzAycHg7bGluZS1oZWlnaHQ6MS4yNTtmb250LWZhbWlseTpzYW5zLXNlcmlmO2xldHRlci1zcGFjaW5nOjA7d29yZC1zcGFjaW5nOjA7b3BhY2l0eToxO2ZpbGw6IzZlZWI4MztmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4yNjQ1ODMzMiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTE4NS4yNTYgLTE4NC41MzcpIj48L3BhdGg+PHBhdGggZD0ibTE5MS4yNjggMTkxLjIyNS0yLjAxNCAyLjcyMS4wMTUuMDI5djQuNDE1YzAgLjYxMi4xODIgMS4xLjU0NiAxLjQ2NGExLjc0IDEuNzQgMCAwIDAgMS4yOS41NDVoLjA1Yy4wNCAwIC4wNzMtLjAyLjExMy0uMDIyem0xLjcyNyAyLjYwNi0xLjcyNy0yLjU5MnY5LjEzOGExLjc2IDEuNzYgMCAwIDAgMS4xNzYtLjUyM2MuMzY0LS4zNTYuNTQ2LS44NDQuNTQ2LTEuNDY0di00LjU1MnoiIHN0eWxlPSJmb250LXN0eWxlOm5vcm1hbDtmb250LXdlaWdodDo0MDA7Zm9udC1zaXplOjEwLjU4MzMzMzAycHg7bGluZS1oZWlnaHQ6MS4yNTtmb250LWZhbWlseTpzYW5zLXNlcmlmO2xldHRlci1zcGFjaW5nOjA7d29yZC1zcGFjaW5nOjA7b3BhY2l0eToxO2ZpbGw6IzMwYmNlZDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4yNjQ1ODMzMiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTE4NS4yNTYgLTE4NC41MzcpIj48L3BhdGg+PHBhdGggZD0iTTE4Ny4wNjIgMTg0LjUzN2MtLjY0NS4wMDgtMS4xNS4yOTctMS41MTMuODY4LS4zNjQuNTctLjM4OSAxLjEzNy0uMDc1IDEuNjk5bDMuNzggNi44NDIgMi4wMTQtMi43MjF2LS4wMDhsLS4wMDIuMDA1YTEyOC40NDUgMTI4LjQ0NSAwIDAgMS0yLjM1Ni01LjU0NGMtLjI5OC0uNzYtLjg0OC0xLjE0MS0xLjY1LTEuMTQxeiIgc3R5bGU9ImZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtd2VpZ2h0OjQwMDtmb250LXNpemU6MTAuNTgzMzMzMDJweDtsaW5lLWhlaWdodDoxLjI1O2ZvbnQtZmFtaWx5OnNhbnMtc2VyaWY7bGV0dGVyLXNwYWNpbmc6MDt3b3JkLXNwYWNpbmc6MDtvcGFjaXR5OjE7ZmlsbDojZmZiYzQyO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjI2NDU4MzMyIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMTg1LjI1NiAtMTg0LjUzNykiPjwvcGF0aD48ZyBzdHlsZT0iZm9udC1zdHlsZTpub3JtYWw7Zm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMC41ODMzMzMwMnB4O2xpbmUtaGVpZ2h0OjEuMjU7Zm9udC1mYW1pbHk6c2Fucy1zZXJpZjtsZXR0ZXItc3BhY2luZzowO3dvcmQtc3BhY2luZzowO2ZpbGw6d2hpdGU7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMjY0NTgzMzIiPjxwYXRoIGQ9Ik0xNDMuNDEgMjYyLjAwOXEwIDEuMDk1LS41NDMgMS43OTMtLjYzNS44LTEuNzIuNTg0LS4wOTMtLjAxNi0uMjMzLS4wODMtLjMzLS4xNi0uMzMtLjUyMiAwLS4yMzIuMTUtLjM5OC4xNTQtLjE2NS4zNzEtLjE2NXQuNDAzLS4wOThxLjQ1NS0uMjEyLjQ1LTEuMDA4di0zLjQzMXEwLS4zLjIxMi0uNTEyLjIwMS0uMjA3LjUwNi0uMjA3aC4wMnEuMzA2IDAgLjUwNy4yMDcuMjA3LjIxMi4yMDcuNTEyem0tLjIyNy00Ljc0NHEtLjIyOC4yNDMtLjU2NC4yNDMtLjMyIDAtLjU1OC0uMjM4LS4yMzctLjIzOC0uMjM3LS41NjMgMC0uMzMuMjI3LS41NjMuMjI3LS4yMzguNTY4LS4yMzguMzM2IDAgLjU2NC4yMzguMjI3LjIzNy4yMjcuNTYzLS4wMDUuMzEtLjIyNy41NTh6bS44OTQgNC40NDVxLjA0Ni0uMTk3LjI1My0uMzIxLjE4Ni0uMTE0LjUwMS0uMDEuMzE1LjEwMy42NC4wOTIuNjIxLS4wMS42MjEtLjM4NyAwLS4xNy0uMTM0LS4yOC0uMTM1LS4xMDgtLjU0My0uMjUyLTEuMzQ0LS40NjYtMS4zMzMtMS40MDYuMDEtLjY3Ny41MjctMS4xLjUxMS0uNDI1IDEuMzctLjQyNS40MDItLjAwNS44MzEuMTE0LjE5MS4wNTIuMzA1LjIyOC4xMDkuMTc1LjA1Mi4zNzd2LjAwNXEtLjAzNi4xOTYtLjIyOC4zMTUtLjE5LjExNC0uNDM0LjA0Ny0uMjQ4LS4wNjgtLjQ4LS4wNzgtLjU1My0uMDEtLjU1My4zNjcgMCAuMTU1LjE2LjI3OS4xNi4xMTkuNTk0LjI2OSAxLjI0Ni40MzkgMS4yNSAxLjQyNi4wMTEuNjc3LS41IDEuMS0uNTEyLjQyLTEuNTA0LjQyLS41MjIgMC0xLjAzOS0uMTQtLjE4LS4wNDctLjMtLjI0OC0uMTEzLS4xODYtLjA1Ni0uMzc4eiIgYXJpYS1sYWJlbD0ianMiIHN0eWxlPSJmb250LXN0eWxlOm5vcm1hbDtmb250LXZhcmlhbnQ6bm9ybWFsO2ZvbnQtd2VpZ2h0OjQwMDtmb250LXN0cmV0Y2g6bm9ybWFsO2ZvbnQtZmFtaWx5OkR5dXRoaTtmaWxsOndoaXRlO2ZpbGwtb3BhY2l0eToxO3N0cm9rZS13aWR0aDowLjI2NDU4MzMyIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMTMyLjQ1MyAtMjQ2LjYzNikiPjwvcGF0aD48L2c+PC9zdmc+&logoColor=white" alt="Yjs"></a>                                                                    |
| Flow Editor      | <a href="https://reactflow.dev/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/React%20Flow-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij4KCTxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yIDBhMiAyIDAgMCAwLTIgMnY2LjY2N2EyIDIgMCAwIDAgMiAyaDYuNjY3YTIgMiAwIDAgMCAyLTJWNy4yMmEyIDIgMCAwIDEtMS4zMzQgMHYxLjQ0N2EuNjY3LjY2NyAwIDAgMS0uNjY2LjY2NkgyYS42NjcuNjY3IDAgMCAxLS42NjctLjY2NlYyYzAtLjM2OC4yOTktLjY2Ny42NjctLjY2N2g2LjY2N2MuMzY4IDAgLjY2Ni4yOTkuNjY2LjY2N3YxLjQ0N2EyIDIgMCAwIDEgMS4zMzQgMFYyYTIgMiAwIDAgMC0yLTJ6bTExLjMzMyAyYTIgMiAwIDAgMSAyLTJIMjJhMiAyIDAgMCAxIDIgMnY2LjY2N2EyIDIgMCAwIDEtMiAyaC0xLjQ0N2EyIDIgMCAwIDAgMC0xLjMzNEgyMmEuNjY3LjY2NyAwIDAgMCAuNjY3LS42NjZWMkEuNjY3LjY2NyAwIDAgMCAyMiAxLjMzM2gtNi42NjdhLjY2Ny42NjcgMCAwIDAtLjY2Ni42Njd2MS40NDdhMiAyIDAgMCAwLTEuMzM0IDB6bTMuNDQ4IDcuMzMzaC0xLjQ0OGEuNjY3LjY2NyAwIDAgMS0uNjY2LS42NjZWNy4yMmEyIDIgMCAwIDEtMS4zMzQgMHYxLjQ0N2EyIDIgMCAwIDAgMiAyaDEuNDQ3YTIgMiAwIDAgMSAwLTEuMzM0bS0xNi43OCA2YTIgMiAwIDAgMSAyLTJoNi42NjdhMiAyIDAgMCAxIDIgMnYxLjQ0N2EyIDIgMCAwIDAtMS4zMzQgMHYtMS40NDdhLjY2Ny42NjcgMCAwIDAtLjY2Ni0uNjY2SDJhLjY2Ny42NjcgMCAwIDAtLjY2Ny42NjZWMjJjMCAuMzY4LjI5OS42NjcuNjY3LjY2N2g2LjY2N0EuNjY3LjY2NyAwIDAgMCA5LjMzMyAyMnYtMS40NDdhMiAyIDAgMCAwIDEuMzM0IDBWMjJhMiAyIDAgMCAxLTIgMkgyYTIgMiAwIDAgMS0yLTJ6bTIyLS42NjZoLTEuNDQ3YTIgMiAwIDAgMCAwLTEuMzM0SDIyYTIgMiAwIDAgMSAyIDJWMjJhMiAyIDAgMCAxLTIgMmgtNi42NjdhMiAyIDAgMCAxLTItMnYtMS40NDdhMiAyIDAgMCAwIDEuMzM0IDBWMjJjMCAuMzY4LjI5OC42NjcuNjY2LjY2N0gyMmEuNjY3LjY2NyAwIDAgMCAuNjY3LS42Njd2LTYuNjY3YS42NjcuNjY3IDAgMCAwLS42NjctLjY2Nm0tNy4zMzMgMi4xMTR2LTEuNDQ4YzAtLjM2OC4yOTgtLjY2Ni42NjYtLjY2NmgxLjQ0N2EyIDIgMCAwIDEgMC0xLjMzNGgtMS40NDdhMiAyIDAgMCAwLTIgMnYxLjQ0N2EyIDIgMCAwIDEgMS4zMzQgME0yMCAxNGExLjMzMyAxLjMzMyAwIDEgMS0xLjY2Ny0xLjI5MVYxMS4yOWExLjMzNCAxLjMzNCAwIDEgMSAuNjY3IDB2MS40MThjLjU3NS4xNDggMSAuNjcgMSAxLjI5MW0tMTAgNmMuNjIxIDAgMS4xNDMtLjQyNSAxLjI5MS0xaDEuNDE4YTEuMzM0IDEuMzM0IDAgMSAwIDAtLjY2N0gxMS4yOUExLjMzNCAxLjMzNCAwIDEgMCAxMCAyMG0xLjI5MS0xNC4zMzNhMS4zMzQgMS4zMzQgMCAxIDEgMC0uNjY3aDEuNDE4YTEuMzM0IDEuMzM0IDAgMSAxIDAgLjY2N3oiIC8+Cjwvc3ZnPg==&badgeColor=black" alt="React Flow"></a>                                                                                                                                                                                                                                               |
| Docs             | <a href="https://fumadocs.vercel.app/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/fuma%20docs-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjAxLjU0IDU0LjQ2QTEwNCAxMDQgMCAwIDAgNTQuNDYgMjAxLjU0QTEwNCAxMDQgMCAwIDAgMjAxLjU0IDU0LjQ2TTE4NCAxOTUuODdhODcgODcgMCAwIDEtMTYgMTAuNVY5OS4zMWwxNi0xNlptLTgwLTMyLjU2bDE2LTE2djY4LjI4YTg4LjQgODguNCAwIDAgMS0xNi0zWm0tMTYgNDMuMDZhODcgODcgMCAwIDEtMTYuMy0xMC43NmwxNi4zLTE2LjNabTQ4LTc1LjA2bDE2LTE2djk3LjMyYTg4LjQgODguNCAwIDAgMS0xNiAzWk00MCAxMjhhODggODggMCAwIDEgMTQ0LjMtNjcuNjFMNjAuMzggMTg0LjMxQTg3LjM0IDg3LjM0IDAgMCAxIDQwIDEyOG0xNjAgNTAuNTlWNzcuNDFhODggODggMCAwIDEgMCAxMDEuMTgiIC8+Cjwvc3ZnPg==&badgeColor=black" alt="Fumadocs"></a>                                                                                                                                                                                                                                               |
| Monorepo         | <a href="https://turborepo.org/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Turborepo-black?style=for-the-badge&logo=turborepo&logoColor=white" alt="Turborepo"></a>                                                                                                                                                                                                                    |
| Background Jobs  | <a href="https://trigger.dev/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Trigger.dev-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj4KCTxwYXRoIGZpbGw9IiM0Y2FmNTAiIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTExLjE1OCAxMy41MUwxNiA1bDEyIDIxLjA5SDRsNC44NDItOC41MWwzLjQyNSAyLjAwN2wtMS40MTYgMi40OWgxMC4yOThMMTYgMTMuMDI3bC0xLjQxNyAyLjQ5eiIgY2xpcC1ydWxlPSJldmVub2RkIiAvPgo8L3N2Zz4=&badgeColor=black" alt="Trigger.dev"></a>                                                                                                                                                                                                                                                 |
| Remote Execution | <a href="https://www.e2b.dev/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/E2B-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjYiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyNiAyOCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIxLjg0NTggMTkuMzAyOUMyMS42NjcxIDE5LjMwMjkgMjEuNTU1NSAxOS40OTYzIDIxLjY0NDggMTkuNjUxMUwyMy41MTQxIDIyLjg4OUMyMy42MTc1IDIzLjA2ODEgMjMuNDUyOCAyMy4yODI4IDIzLjI1MyAyMy4yMjkzTDE3LjU4MzYgMjEuNzEwMUMxNy4zMzU5IDIxLjY0MzcgMTcuMDgxMyAyMS43OTA3IDE3LjAxNDkgMjIuMDM4NEwxNS40OTU4IDI3LjcwNzlDMTUuNDQyMiAyNy45MDc3IDE1LjE3MzkgMjcuOTQzIDE1LjA3MDUgMjcuNzYzOUwxMy4yMDA4IDI0LjUyNTRDMTMuMTExNSAyNC4zNzA3IDEyLjg4ODEgMjQuMzcwNyAxMi43OTg3IDI0LjUyNTRMMTAuOTI5IDI3Ljc2MzlDMTAuODI1NiAyNy45NDMgMTAuNTU3MyAyNy45MDc3IDEwLjUwMzggMjcuNzA3OUw4Ljk4NDYgMjIuMDM4NEM4LjkxODI0IDIxLjc5MDcgOC42NjM2NSAyMS42NDM3IDguNDE1OTcgMjEuNzEwMUwyLjc0NjUyIDIzLjIyOTNDMi41NDY3NSAyMy4yODI4IDIuMzgxOTkgMjMuMDY4MSAyLjQ4NTQgMjIuODg5TDQuMzU0NzIgMTkuNjUxMUM0LjQ0NDA2IDE5LjQ5NjMgNC4zMzIzOCAxOS4zMDI5IDQuMTUzNjggMTkuMzAyOUwwLjQxNTIyMiAxOS4zMDI4QzAuMjA4NDA2IDE5LjMwMjggMC4xMDQ4MzQgMTkuMDUyOCAwLjI1MTA3NyAxOC45MDY2TDQuNDAxNDUgMTQuNzU2M0M0LjU4Mjc3IDE0LjU3NDkgNC41ODI3NyAxNC4yODEgNC40MDE0NSAxNC4wOTk3TDAuMjUxMDc5IDkuOTQ5MjdDMC4xMDQ4MzcgOS44MDMwMiAwLjIwODQxNCA5LjU1Mjk3IDAuNDE1MjMyIDkuNTUyOTdMNC4xNTMyOCA5LjU1MzAyQzQuMzMxOTggOS41NTMwMiA0LjQ0MzY4IDkuMzU5NTcgNC4zNTQzMyA5LjIwNDgxTDIuNDg1NCA1Ljk2NzYzQzIuMzgxOTkgNS43ODg1MiAyLjU0Njc2IDUuNTczOCAyLjc0NjUyIDUuNjI3MzNMOC40MTU5NyA3LjE0NjUyQzguNjYzNjUgNy4yMTI4OCA4LjkxODI0IDcuMDY1OSA4Ljk4NDYxIDYuODE4MjJMMTAuNTAzOCAxLjE0ODY5QzEwLjU1NzMgMC45NDg5MTggMTAuODI1NiAwLjkxMzU5MiAxMC45MjkgMS4wOTI3TDEyLjc5ODcgNC4zMzExNkMxMi44ODgxIDQuNDg1OTMgMTMuMTExNCA0LjQ4NTkzIDEzLjIwMDggNC4zMzExNkwxNS4wNzA1IDEuMDkyN0MxNS4xNzM5IDAuOTEzNTkyIDE1LjQ0MjIgMC45NDg5MTcgMTUuNDk1NyAxLjE0ODY5TDE3LjAxNDkgNi44MTgyMkMxNy4wODEzIDcuMDY1OSAxNy4zMzU5IDcuMjEyODggMTcuNTgzNSA3LjE0NjUyTDIzLjI1MyA1LjYyNzMzQzIzLjQ1MjggNS41NzM4IDIzLjYxNzUgNS43ODg1MiAyMy41MTQxIDUuOTY3NjNMMjEuNjQ1MiA5LjIwNDgxQzIxLjU1NTggOS4zNTk1NyAyMS42Njc1IDkuNTUzMDIgMjEuODQ2MiA5LjU1MzAyTDI1LjU4NDQgOS41NTI5N0MyNS43OTEyIDkuNTUyOTcgMjUuODk0OCA5LjgwMzAyIDI1Ljc0ODYgOS45NDkyN0wyMS41OTgyIDE0LjA5OTdDMjEuNDE2OSAxNC4yODEgMjEuNDE2OSAxNC41NzQ5IDIxLjU5ODIgMTQuNzU2M0wyNS43NDg2IDE4LjkwNjZDMjUuODk0OCAxOS4wNTI4IDI1Ljc5MTIgMTkuMzAyOCAyNS41ODQ0IDE5LjMwMjhMMjEuODQ1OCAxOS4zMDI5Wk0yMC40MTkgMTAuNDA0QzIwLjU4NjkgMTAuMjM2IDIwLjQyNDEgOS45NTQxIDIwLjE5NDcgMTAuMDE1NkwxNS4xNDYxIDExLjM2ODRDMTQuODk4NCAxMS40MzQ4IDE0LjY0MzggMTEuMjg3OCAxNC41Nzc1IDExLjA0MDFMMTMuMjI0IDUuOTg4ODhDMTMuMTYyNSA1Ljc1OTQ3IDEyLjgzNyA1Ljc1OTQ3IDEyLjc3NTUgNS45ODg4OEwxMS40MjIgMTEuMDQwMUMxMS4zNTU3IDExLjI4NzggMTEuMTAxMSAxMS40MzQ4IDEwLjg1MzQgMTEuMzY4NEw1LjgwNDk2IDEwLjAxNTZDNS41NzU1NSA5Ljk1NDE0IDUuNDEyNzggMTAuMjM2MSA1LjU4MDcyIDEwLjQwNEw5LjI3NjQzIDE0LjA5OTdDOS40NTc3NCAxNC4yODEgOS40NTc3NCAxNC41NzUgOS4yNzY0MyAxNC43NTYzTDUuNTc5ODUgMTguNDUyOEM1LjQxMTkxIDE4LjYyMDggNS41NzQ2NyAxOC45MDI3IDUuODA0MDkgMTguODQxMkwxMC44NTM0IDE3LjQ4ODJDMTEuMTAxMSAxNy40MjE4IDExLjM1NTcgMTcuNTY4OCAxMS40MjIgMTcuODE2NUwxMi43NzU1IDIyLjg2NzdDMTIuODM3IDIzLjA5NzIgMTMuMTYyNSAyMy4wOTcyIDEzLjIyNCAyMi44Njc3TDE0LjU3NzUgMTcuODE2NUMxNC42NDM5IDE3LjU2ODggMTQuODk4NCAxNy40MjE4IDE1LjE0NjEgMTcuNDg4MkwyMC4xOTU2IDE4Ljg0MTNDMjAuNDI1IDE4LjkwMjcgMjAuNTg3OCAxOC42MjA4IDIwLjQxOTggMTguNDUyOUwxNi43MjMyIDE0Ljc1NjNDMTYuNTQxOSAxNC41NzUgMTYuNTQxOSAxNC4yODEgMTYuNzIzMiAxNC4wOTk3TDIwLjQxOSAxMC40MDRaIiBmaWxsPSJ3aGl0ZSI+PC9wYXRoPgo8L3N2Zz4=&logoColor=white" alt="E2B"></a>                                                                                                                                                                                                                                                                 |
| Charting         | <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Lightweight%20Charts-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDYiIGhlaWdodD0iNzEiIHZpZXdCb3g9IjAgMCAxMDYgNzEiIGZpbGw9Im5vbmUiPjxwYXRoIGQ9Ik0xMDAuNDQgNi45Yy05LjI4IDI0LjYyLTIzLjQ2IDM1Ljc0LTM0LjEgMzkuMjhhNy4xNCA3LjE0IDAgMCAxLTYuOTcgNi4xM0E3LjE5IDcuMTkgMCAwIDEgNTIuMyA0NWMwLTEuMTUuMjUtMi4yNC43LTMuMkw0Mi44OSAzMS4zYTYuODcgNi44NyAwIDAgMS04LjYtLjIzTDkuMDMgNTAuNTdjNS4wOCA2LjY2IDExLjU5IDEyLjEzIDE4LjgyIDE1LjQ4bC4yNS4xMmguMzJhNS4yNCA1LjI0IDAgMCAwIC4zOC0uMDJjLjI2LS4wMS42Mi0uMDUgMS4wOS0uMWEyNS4xIDI1LjEgMCAwIDAgMy44Ni0uODYgMzUuNSAzNS41IDAgMCAwIDkuNy00LjcyIDE3LjQzIDE3LjQzIDAgMCAxLTYuNDcgOC43OGwyLjkuNmMxMi42MyAyLjYyIDI3LjQ3LTEuMzkgMzguOTYtMTAuOTggMTAuNjYtOC45IDE4LjM4LTIxLjgxIDE4Ljg1LTM5LjQ1IDMuNjQtNi40MiA2LjM3LTE0LjYgNy42Ny0xOC41bC4wNy0uMTktMy4yIDEuNWE4MS40MiA4MS40MiAwIDAgMS0xLjggNC42OHoiIGZpbGw9IiMyMTk2RjMiLz48cGF0aCBkPSJNNy40MSA0OC4zNWE1NS41NiA1NS41NiAwIDAgMS03LjItMTQuNTNMMCAzMy4xOGwuMy0uNThDMTEuOTcgMTAuNzcgMzcuODcgMi40IDU3LjkgMTAuMDNsLjc2LjMuMTEuODdhMjEuNjggMjEuNjggMCAwIDAgMy4xNSA5LjAyIDE5LjEzIDE5LjEzIDAgMCAwIDMuMzIgMy42Yy0zLTYuNTMtMi4zNS0xMS42MS0yLjM1LTExLjYxbDEuODYgMS4yYzguMzcgNS4wNCAxOS43OCA2LjQyIDI5LjUuNDQtOC41MyAxNy44LTE5LjU3IDI2LjM1LTI4LjAyIDI5LjQzYTcuMTIgNy4xMiAwIDAgMC02Ljg2LTUuNiA2LjkgNi45IDAgMCAwLTQuNzIgMS44N2wtOS45NC0xMC4zYTcuNDcgNy40NyAwIDAgMCAxLjA3LTMuODYgNy4xOSA3LjE5IDAgMCAwLTcuMDYtNy4zMiA3LjE5IDcuMTkgMCAwIDAtNy4wNiA3LjMyYzAgMS4yOS4zMiAyLjUuODkgMy41NUw3LjQgNDguMzV6IiBmaWxsPSIjMjE5NkYzIi8+PHBhdGggZD0iTTQzLjEgMjUuMzljMCAyLjUtMS45NyA0LjUyLTQuMzggNC41MmE0LjQ1IDQuNDUgMCAwIDEtNC4zNy00LjUyYzAtMi41IDEuOTYtNC41MyA0LjM3LTQuNTNhNC40NSA0LjQ1IDAgMCAxIDQuMzcgNC41M3pNNjMuNiA0NWE0LjM5IDQuMzkgMCAwIDEtNC4yMyA0LjUyQTQuMzkgNC4zOSAwIDAgMSA1NS4xMyA0NWE0LjM5IDQuMzkgMCAwIDEgNC4yNC00LjUzYzIuMjEgMCA0LjI0IDEuOSA0LjI0IDQuNTN6IiBmaWxsPSIjMjE5NkYzIi8+PC9zdmc+&badgeColor=black" alt="Lightweight Charts"></a>                                                                                                                                                                                                      |
| Indicator Engine | <a href="https://github.com/QuantForgeOrg/PineTS" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Pinets-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij4KCTxwYXRoIGZpbGw9IiM2NmJiNmEiIGQ9Ik0xMi4wMzggMy4xMTVjLS4xMzQuMDAyLS4yNzEuMDgzLS40MjYuMjRjLS40NjcuNDc4LTYuNzY0IDkuMzg4LTYuNzY0IDkuNTcyYzAgLjI2NC40NTguNjc3Ljc1LjY3N2MuMTU0IDAgLjcyNC0uMjQgMS4yNjgtLjUzNWMuNzEyLS4zODYgMS4wMTItLjYzNSAxLjA3NS0uODkyYy4yNTQtMS4wNC44NzMtMS41NyAxLjgyNy0xLjU3Yy43MyAwIDEuNDk0LjcyMyAxLjYgMS41MTdjLjA3My41NDIuMTc0LjY2IDEuMjU5IDEuNDYzYy42NDkuNDggMS4yNDQuODc0IDEuMzIzLjg3NGMuMDggMCAuMzI4LS4wOTYuNTUzLS4yMTRjLjU0NS0uMjg0Ljg4Ni0uMjcgMS40ODIuMDYzYy4yNzMuMTUyLjU1Ni4yOC42MjcuMjg1Yy4yMi4wMTQgMi4zODktMS4zMDcgMi40NjMtMS41Yy4wMzgtLjEgMC0uMzExLS4wODMtLjQ3Yy0uMTE5LS4yMi01LjI0My03LjQ5NS02LjQyLTkuMTE0Yy0uMTk1LS4yNjctLjM2Mi0uMzk3LS41MzQtLjM5NiIgLz4KCTxwYXRoIGZpbGw9IiMzODhlM2MiIGQ9Im04LjM5MiAxMy41ODRsLTMuNDcyIDEuOTdsLTEuNTM0IDIuMTNjLTEuNjE0IDIuMjQxLTEuODIgMi42NDMtMS41MzQgMi45ODhjLjE1My4xODQgMS40ODguMjEyIDEwLjA2OC4yMTJjNS40NCAwIDkuOTk0LS4wMzkgMTAuMTE4LS4wODZjLjEyNC0uMDQ4LjIyNi0uMjMuMjI2LS40MDdjMC0uMzQxLTMuMzMtNS4xODktMy42NDgtNS4zMWMtLjM4My0uMTQ4LTEuNDkxLjY3NC0xLjg0MSAxLjM2NGMtLjM5Mi43NzMtLjg4MyAxLjA4NS0xLjY3NCAxLjA2NGMtLjY5OC0uMDE4LTEuMzA2LS41NS0xLjU3NC0xLjM3OGMtLjE1NC0uNDc4LS4zOTctLjcyNS0xLjQ1Ny0xLjQ4NWMtLjg2Mi0uNjE4LTEuMzQ1LS44OC0xLjQ5OS0uODExYy0uNTAyLjIyMy0xLjI3NC4yMTctMS43Mi0uMDE0eiIgLz4KPC9zdmc+&logoColor=white" alt="PineTS"></a>                                                                                                                                                                                                                                        |
| Drawing Tools    | <a href="https://github.com/difurious/lightweight-charts-line-tools-core" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Line%20Tools-black?style=for-the-badge" alt="Line Tools"></a>                                                                                                                                                                                                      |



## Special Thanks

Special thanks to the [Sim Studio](https://github.com/simstudioai) team for open-sourcing the original project this repository is built on top of.
TradingGoose Studio started from Sim Studio [`v0.4.25`](https://github.com/simstudioai/sim/releases/tag/v0.4.25).

---

## License

The combined TradingGoose Studio project is licensed under **AGPL-3.0-only** - see the [LICENSE](LICENSE) file for details.
This is not because the Sim Studio upstream is Apache-2.0; those upstream notices remain preserved. The combined
project is AGPL-3.0-only because TradingGoose Studio integrates PineTS under its AGPL terms, and this project is
intentionally kept as free software so users can use, study, modify, self-host, and redistribute it under the same terms.
Additional attributions and third-party license texts are in [NOTICE](NOTICE) and [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES).
The Apache-2.0 text preserved for Sim Studio and Lightweight Charts is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
Those Apache-related notices still stay in the repository because this project is derived from Apache-licensed upstream
code and also distributes Apache-licensed third-party components whose attribution notices must be preserved.

The chart drawing tools vendored in `apps/tradinggoose/widgets/widgets/data_chart/plugins/`
carry their own MPL-2.0 license file at
`apps/tradinggoose/widgets/widgets/data_chart/plugins/LICENSE`.
Those vendored modified source files remain covered by the MPL-2.0 at the file level.
The project's overall AGPL-3.0-only distribution does not replace or remove the MPL-2.0
terms that continue to apply to that directory.

---

<p align="center">
  Built with ❤️ by the TradingGoose Team
</p>
