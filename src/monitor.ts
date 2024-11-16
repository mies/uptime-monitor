// src/monitor.ts
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from './db/schema'

interface Env {
  DB: D1Database
}

export class Monitor {
  private state: DurableObjectState
  private env: Env
  private checkTimer: ReturnType<typeof setInterval> | null = null

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    
    switch (url.pathname) {
      case '/schedule':
        await this.scheduleChecks()
        return new Response('Monitoring scheduled')
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  async scheduleChecks() {
    // Clear existing timer if any
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
    }

    const db = drizzle(this.env.DB)
    const websiteId = parseInt(this.state.id.toString(), 10)

    // Get website details
    const website = await db.select()
      .from(schema.websites)
      .where(eq(schema.websites.id, websiteId))
      .get()

    if (!website) {
      return
    }

    // Schedule periodic checks
    this.checkTimer = setInterval(async () => {
      await this.performCheck(website)
    }, website.checkInterval * 1000)

    // Perform initial check
    await this.performCheck(website)
  }

  async performCheck(website: typeof schema.websites.$inferSelect) {
    let isUp = false
    let responseTime = 0
    let status = 0
    const db = drizzle(this.env.DB)

    const startTime = Date.now()

    try {
      const response = await fetch(website.url, {
        method: 'GET',
        redirect: 'follow',
        cf: {
          cacheTTL: 0,
          cacheEverything: false
        }
      })

      responseTime = Date.now() - startTime
      status = response.status
      isUp = response.status >= 200 && response.status < 400
    } catch (error) {
      responseTime = Date.now() - startTime
      isUp = false
    }

    // Store check result
    await db.insert(schema.uptimeChecks).values({
      websiteId: website.id,
      timestamp: new Date().toISOString(),
      status,
      responseTime,
      isUp
    })
  }
}