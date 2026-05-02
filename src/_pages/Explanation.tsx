// Explanation.tsx — Displays explanation agent results
import React, { useState, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism"
import { COMMAND_KEY } from "../utils/platform"

interface ExplanationData {
  title: string
  explanation: string
  keyPoints: string[]
  codeExamples?: string[]
  relatedTopics?: string[]
}

interface ExplanationProps {
  setView: (view: "queue" | "solutions" | "debug" | "mcq" | "explanation") => void
  currentLanguage: string
}

const Explanation: React.FC<ExplanationProps> = ({ setView, currentLanguage }) => {
  const queryClient = useQueryClient()
  const contentRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<ExplanationData | null>(null)

  useEffect(() => {
    const cached = queryClient.getQueryData(["explanation_result"]) as ExplanationData | null
    if (cached) setData(cached)

    const unsubscribe = window.electronAPI.onExplanationResult((result: ExplanationData) => {
      setData(result)
      queryClient.setQueryData(["explanation_result"], result)
    })
    return () => { unsubscribe() }
  }, [])

  // Resize
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
  }, [data])

  if (!data) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
          <p className="text-xs text-white/60">Generating explanation...</p>
        </div>
      </div>
    )
  }

  /**
   * Simple markdown-ish renderer for the explanation text.
   * Handles headings, bold, code blocks, and bullet points.
   */
  const renderExplanation = (text: string) => {
    const lines = text.split("\n")
    const elements: React.ReactNode[] = []
    let inCodeBlock = false
    let codeBuffer: string[] = []
    let codeLanguage = currentLanguage

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Code block toggle
      if (line.trim().startsWith("```")) {
        if (inCodeBlock) {
          // End code block
          elements.push(
            <div key={`code-${i}`} className="my-2 rounded-md overflow-hidden">
              <SyntaxHighlighter
                language={codeLanguage === "golang" ? "go" : codeLanguage}
                style={dracula}
                customStyle={{
                  margin: 0,
                  padding: "0.75rem",
                  fontSize: "12px",
                  backgroundColor: "rgba(22, 27, 34, 0.5)",
                }}
                wrapLongLines
              >
                {codeBuffer.join("\n")}
              </SyntaxHighlighter>
            </div>
          )
          codeBuffer = []
          inCodeBlock = false
        } else {
          // Start code block
          const lang = line.trim().replace("```", "").trim()
          if (lang) codeLanguage = lang
          inCodeBlock = true
        }
        continue
      }

      if (inCodeBlock) {
        codeBuffer.push(line)
        continue
      }

      // Headings
      if (line.startsWith("### ")) {
        elements.push(
          <h4 key={i} className="text-[13px] font-semibold text-white mt-3 mb-1">
            {line.replace("### ", "")}
          </h4>
        )
      } else if (line.startsWith("## ")) {
        elements.push(
          <h3 key={i} className="text-[14px] font-semibold text-white mt-4 mb-1">
            {line.replace("## ", "")}
          </h3>
        )
      } else if (line.startsWith("# ")) {
        elements.push(
          <h2 key={i} className="text-[15px] font-bold text-white mt-4 mb-2">
            {line.replace("# ", "")}
          </h2>
        )
      }
      // Bullet points
      else if (/^\s*[-*•]\s/.test(line)) {
        elements.push(
          <div key={i} className="flex items-start gap-2 ml-2">
            <div className="w-1 h-1 rounded-full bg-blue-400/80 mt-2 shrink-0" />
            <span className="text-[13px] leading-[1.5] text-gray-200">
              {line.replace(/^\s*[-*•]\s/, "")}
            </span>
          </div>
        )
      }
      // Regular paragraph
      else if (line.trim()) {
        elements.push(
          <p key={i} className="text-[13px] leading-[1.5] text-gray-200">
            {line}
          </p>
        )
      }
    }

    return <div className="space-y-1">{elements}</div>
  }

  return (
    <div ref={contentRef} className="relative">
      <div className="space-y-3 px-4 py-3">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/30">
              <span className="text-[11px] font-medium text-cyan-300">Explanation</span>
            </div>
            <span className="text-[11px] text-white/40">
              {COMMAND_KEY} + R to reset
            </span>
          </div>
        </div>

        {/* Main content */}
        <div className="w-full text-sm bg-black/60 rounded-md">
          <div className="rounded-lg overflow-hidden">
            <div className="px-4 py-3 space-y-4 max-w-full">

              {/* Title */}
              <h2 className="text-[15px] font-semibold text-white">
                {data.title}
              </h2>

              {/* Explanation body */}
              <div className="bg-white/5 rounded-md p-3">
                {renderExplanation(data.explanation)}
              </div>

              {/* Key points */}
              {data.keyPoints.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[13px] font-medium text-white tracking-wide">
                    Key Points
                  </h3>
                  <div className="space-y-1">
                    {data.keyPoints.map((point, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-emerald-400/80 mt-2 shrink-0" />
                        <span className="text-[13px] leading-[1.4] text-gray-100">
                          {point}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Code examples */}
              {data.codeExamples && data.codeExamples.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[13px] font-medium text-white tracking-wide">
                    Code Examples
                  </h3>
                  {data.codeExamples.map((code, i) => (
                    <div key={i} className="rounded-md overflow-hidden">
                      <SyntaxHighlighter
                        language={currentLanguage === "golang" ? "go" : currentLanguage}
                        style={dracula}
                        customStyle={{
                          margin: 0,
                          padding: "0.75rem",
                          fontSize: "12px",
                          backgroundColor: "rgba(22, 27, 34, 0.5)",
                        }}
                        wrapLongLines
                      >
                        {code}
                      </SyntaxHighlighter>
                    </div>
                  ))}
                </div>
              )}

              {/* Related topics */}
              {data.relatedTopics && data.relatedTopics.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[13px] font-medium text-white tracking-wide">
                    Related Topics
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.relatedTopics.map((topic, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] text-gray-300"
                      >
                        {topic}
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

export default Explanation
