// MCQResults.tsx — Displays MCQ solver agent results
import React, { useState, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "../contexts/toast"
import { COMMAND_KEY } from "../utils/platform"

interface MCQResultData {
  question: string
  options: string[]
  selectedAnswer: string
  selectedIndex: number
  confidence: number
  reasoning: string
  explanation: string
  relatedConcepts: string[]
}

interface MCQResultsProps {
  setView: (view: "queue" | "solutions" | "debug" | "mcq" | "explanation") => void
  currentLanguage: string
}

const MCQResults: React.FC<MCQResultsProps> = ({ setView, currentLanguage }) => {
  const queryClient = useQueryClient()
  const contentRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()
  const [mcqData, setMcqData] = useState<MCQResultData | null>(null)
  const [showReasoning, setShowReasoning] = useState(false)

  useEffect(() => {
    // Get MCQ data from cache
    const cached = queryClient.getQueryData(["mcq_result"]) as MCQResultData | null
    if (cached) setMcqData(cached)

    // Listen for new MCQ results
    const unsubscribe = window.electronAPI.onMCQResult((data: MCQResultData) => {
      setMcqData(data)
      queryClient.setQueryData(["mcq_result"], data)
    })

    return () => { unsubscribe() }
  }, [])

  // Resize handling
  useEffect(() => {
    if (!contentRef.current) return
    const updateDimensions = () => {
      if (!contentRef.current) return
      window.electronAPI.updateContentDimensions({
        width: contentRef.current.scrollWidth,
        height: contentRef.current.scrollHeight,
      })
    }
    const observer = new ResizeObserver(updateDimensions)
    observer.observe(contentRef.current)
    updateDimensions()
    return () => observer.disconnect()
  }, [mcqData, showReasoning])

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return "from-emerald-400 to-green-500"
    if (confidence >= 0.7) return "from-yellow-400 to-amber-500"
    return "from-orange-400 to-red-500"
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.9) return "Very High"
    if (confidence >= 0.7) return "High"
    if (confidence >= 0.5) return "Moderate"
    return "Low"
  }

  if (!mcqData) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
          <p className="text-xs text-white/60">Analyzing MCQ...</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={contentRef} className="relative">
      <div className="space-y-3 px-4 py-3">

        {/* Header badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/30">
              <span className="text-[11px] font-medium text-violet-300">MCQ Solver</span>
            </div>
            <span className="text-[11px] text-white/40">
              {COMMAND_KEY} + R to reset
            </span>
          </div>
        </div>

        {/* Main content card */}
        <div className="w-full text-sm bg-black/60 rounded-md">
          <div className="rounded-lg overflow-hidden">
            <div className="px-4 py-3 space-y-4 max-w-full">

              {/* Question */}
              <div className="space-y-2">
                <h2 className="text-[13px] font-medium text-white tracking-wide">
                  Question
                </h2>
                <p className="text-[13px] leading-[1.5] text-gray-100">
                  {mcqData.question}
                </p>
              </div>

              {/* Options */}
              <div className="space-y-2">
                <h2 className="text-[13px] font-medium text-white tracking-wide">
                  Options
                </h2>
                <div className="space-y-1.5">
                  {mcqData.options.map((option, index) => {
                    const isSelected = index === mcqData.selectedIndex
                    return (
                      <div
                        key={index}
                        className={`flex items-start gap-3 px-3 py-2 rounded-md transition-all ${
                          isSelected
                            ? "bg-emerald-500/15 border border-emerald-400/40"
                            : "bg-white/5 border border-transparent"
                        }`}
                      >
                        <span
                          className={`text-[12px] font-bold mt-0.5 shrink-0 ${
                            isSelected ? "text-emerald-400" : "text-white/40"
                          }`}
                        >
                          {String.fromCharCode(65 + index)})
                        </span>
                        <span
                          className={`text-[13px] leading-[1.4] ${
                            isSelected ? "text-emerald-100 font-medium" : "text-gray-300"
                          }`}
                        >
                          {option}
                        </span>
                        {isSelected && (
                          <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-300 font-medium">
                            ✓ ANSWER
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Confidence meter */}
              <div className="space-y-2">
                <h2 className="text-[13px] font-medium text-white tracking-wide">
                  Confidence
                </h2>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${getConfidenceColor(mcqData.confidence)} transition-all duration-700`}
                      style={{ width: `${mcqData.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[12px] text-white/60 shrink-0">
                    {Math.round(mcqData.confidence * 100)}% — {getConfidenceLabel(mcqData.confidence)}
                  </span>
                </div>
              </div>

              {/* Explanation */}
              <div className="space-y-2">
                <h2 className="text-[13px] font-medium text-white tracking-wide">
                  Explanation
                </h2>
                <div className="text-[13px] leading-[1.5] text-gray-100 bg-white/5 rounded-md p-3">
                  {mcqData.explanation}
                </div>
              </div>

              {/* Reasoning (collapsible) */}
              <div className="space-y-2">
                <button
                  onClick={() => setShowReasoning(!showReasoning)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-blue-400 hover:text-blue-300 transition"
                >
                  <span className={`transform transition-transform ${showReasoning ? "rotate-90" : ""}`}>
                    ▶
                  </span>
                  Chain-of-Thought Reasoning
                </button>
                {showReasoning && (
                  <div className="text-[12px] leading-[1.6] text-gray-300 bg-white/5 rounded-md p-3 border-l-2 border-blue-400/30">
                    {mcqData.reasoning}
                  </div>
                )}
              </div>

              {/* Related concepts */}
              {mcqData.relatedConcepts.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-[13px] font-medium text-white tracking-wide">
                    Related Concepts
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {mcqData.relatedConcepts.map((concept, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] text-gray-300"
                      >
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MCQResults
