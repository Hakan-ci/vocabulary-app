import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./tests/ai-browser',workers:1,use:{baseURL:'http://127.0.0.1:4188',channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4188 --strictPort',url:'http://127.0.0.1:4188',reuseExistingServer:!process.env.CI},reporter:'list'})
