// ProcessingHelper.ts
// Thin wrapper that delegates to the Orchestrator-based agentic system.
// Preserves the exact same public API for backward compatibility with main.ts and ipcHandlers.ts.

import fs from "node:fs"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { BrowserWindow } from "electron"
import { configHelper } from "./ConfigHelper"
import { Orchestrator } from "./agents/Orchestrator"
import { ProcessingStatus } from "./agents/types"

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private orchestrator: Orchestrator

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()!

    // Initialize the agentic orchestrator
    this.orchestrator = new Orchestrator()
    console.log("[ProcessingHelper] Initialized with Orchestrator-based agentic system")
  }

  /**
   * Returns the Orchestrator instance (for direct agent access if needed).
   */
  getOrchestrator(): Orchestrator {
    return this.orchestrator
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getLanguage(): Promise<string> {
    try {
      const config = configHelper.loadConfig();
      if (config.language) return config.language;

      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )
          if (typeof language === "string" && language) return language;
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  /**
   * Sends a progress update to the renderer.
   */
  private sendProgress(mainWindow: BrowserWindow, status: ProcessingStatus): void {
    mainWindow.webContents.send("processing-status", {
      message: status.message,
      progress: status.progress,
    })
  }

  // ─── Main processing entry point ──────────────────────────────────

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    // Verify the provider is ready
    if (!this.orchestrator.isReady()) {
      console.error("AI provider not initialized")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
      return
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      await this.processMainQueue(mainWindow)
    } else {
      await this.processExtraQueue(mainWindow)
    }
  }

  // ─── Main queue (initial problem solving) ─────────────────────────

  private async processMainQueue(mainWindow: BrowserWindow): Promise<void> {
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
    const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
    console.log("Processing main queue screenshots:", screenshotQueue)

    // Check if the queue is empty
    if (!screenshotQueue || screenshotQueue.length === 0) {
      console.log("No screenshots found in queue")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    // Check that files actually exist
    const existingScreenshots = screenshotQueue.filter(p => fs.existsSync(p))
    if (existingScreenshots.length === 0) {
      console.log("Screenshot files don't exist on disk")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    try {
      // Initialize AbortController
      this.currentProcessingAbortController = new AbortController()
      const { signal } = this.currentProcessingAbortController

      // Read screenshot data
      const screenshots = await Promise.all(
        existingScreenshots.map(async (filepath) => {
          try {
            return {
              path: filepath,
              preview: await this.screenshotHelper.getImagePreview(filepath),
              data: fs.readFileSync(filepath).toString('base64')
            }
          } catch (err) {
            console.error(`Error reading screenshot ${filepath}:`, err)
            return null
          }
        })
      )

      const validScreenshots = screenshots.filter(Boolean) as Array<{ path: string; preview: string; data: string }>

      if (validScreenshots.length === 0) {
        throw new Error("Failed to load screenshot data")
      }

      const language = await this.getLanguage()

      // ── Delegate to the Orchestrator ──
      const agentResult = await this.orchestrator.processScreenshots(
        validScreenshots,
        language,
        signal,
        (status) => this.sendProgress(mainWindow, status)
      )

      if (!agentResult.success) {
        console.log("Processing failed:", agentResult.error)
        if (agentResult.error?.includes("API") || agentResult.error?.includes("key")) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            agentResult.error
          )
        }
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
        return
      }

      // ── Route result to the correct frontend view based on query type ──
      const queryType = agentResult.queryType

      // Store problem info for potential debug follow-up
      const resultData = agentResult.data as any;
      if (resultData?.problem_statement || agentResult.metadata?.problemInfo) {
        this.deps.setProblemInfo(agentResult.metadata?.problemInfo || resultData);
      }

      // Clear extra screenshots before transitioning
      this.screenshotHelper.clearExtraScreenshotQueue()

      // Send the result based on query type
      switch (queryType) {
        case 'mcq':
          mainWindow.webContents.send("mcq-result", agentResult.data)
          mainWindow.webContents.send("query-classified", { queryType: 'mcq', confidence: agentResult.confidence })
          this.deps.setView("solutions")
          break

        case 'explanation':
          mainWindow.webContents.send("explanation-result", agentResult.data)
          mainWindow.webContents.send("query-classified", { queryType: 'explanation', confidence: agentResult.confidence })
          this.deps.setView("solutions")
          break

        case 'mixed': {
          // For mixed queries, send the primary result as a solution
          // and secondary results as additional data
          const primaryData = agentResult.data
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            primaryData
          )
          // Send secondary results if present
          const secondaryResults = agentResult.metadata?.secondaryResults as any[];
          if (secondaryResults) {
            for (const secondary of secondaryResults) {
              if (secondary.queryType === 'mcq') {
                mainWindow.webContents.send("mcq-result", secondary.data)
              } else if (secondary.queryType === 'explanation') {
                mainWindow.webContents.send("explanation-result", secondary.data)
              }
            }
          }
          mainWindow.webContents.send("query-classified", { queryType: 'mixed', confidence: agentResult.confidence })
          this.deps.setView("solutions")
          break
        }

        case 'code_generation':
        case 'debugging':
        default:
          // Standard code solution flow (backward compatible)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            agentResult.data
          )
          mainWindow.webContents.send("query-classified", { queryType, confidence: agentResult.confidence })
          this.deps.setView("solutions")
          break
      }

      // Send progress complete
      this.sendProgress(mainWindow, { message: "Complete", progress: 100 })

    } catch (error: any) {
      if (axios.isCancel(error)) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          "Processing was canceled by the user."
        )
      } else {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error.message || "Server error. Please try again."
        )
      }
      console.log("Resetting view to queue due to error")
      this.deps.setView("queue")
    } finally {
      this.currentProcessingAbortController = null
    }
  }

  // ─── Extra queue (debugging) ──────────────────────────────────────

  private async processExtraQueue(mainWindow: BrowserWindow): Promise<void> {
    const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue()
    console.log("Processing extra queue screenshots:", extraScreenshotQueue)

    if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
      console.log("No extra screenshots found in queue")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    const existingExtraScreenshots = extraScreenshotQueue.filter(p => fs.existsSync(p))
    if (existingExtraScreenshots.length === 0) {
      console.log("Extra screenshot files don't exist on disk")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

    this.currentExtraProcessingAbortController = new AbortController()
    const { signal } = this.currentExtraProcessingAbortController

    try {
      // Get all screenshots (both main and extra) for context
      const allPaths = [
        ...this.screenshotHelper.getScreenshotQueue(),
        ...existingExtraScreenshots
      ]

      const screenshots = await Promise.all(
        allPaths.map(async (filepath) => {
          try {
            if (!fs.existsSync(filepath)) return null
            return {
              path: filepath,
              preview: await this.screenshotHelper.getImagePreview(filepath),
              data: fs.readFileSync(filepath).toString('base64')
            }
          } catch (err) {
            console.error(`Error reading screenshot ${filepath}:`, err)
            return null
          }
        })
      )

      const validScreenshots = screenshots.filter(Boolean) as Array<{ path: string; preview: string; data: string }>

      if (validScreenshots.length === 0) {
        throw new Error("Failed to load screenshot data for debugging")
      }

      const language = await this.getLanguage()
      const problemInfo = this.deps.getProblemInfo()

      // ── Delegate to the Orchestrator's debug pipeline ──
      const agentResult = await this.orchestrator.processDebugScreenshots(
        validScreenshots,
        problemInfo,
        language,
        signal,
        (status) => this.sendProgress(mainWindow, status)
      )

      if (agentResult.success) {
        this.deps.setHasDebugged(true)
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
          agentResult.data
        )
      } else {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
          agentResult.error
        )
      }
    } catch (error: any) {
      if (axios.isCancel(error)) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
          "Extra processing was canceled by the user."
        )
      } else {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      }
    } finally {
      this.currentExtraProcessingAbortController = null
    }
  }

  // ─── Cancel & cleanup ─────────────────────────────────────────────

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)
    this.deps.setProblemInfo(null)
    this.orchestrator.resetContext()

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
