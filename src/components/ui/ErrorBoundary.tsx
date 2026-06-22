"use client"

import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | undefined
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: undefined }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-4 bg-bg-panel border border-data-bear/30 rounded">
            <div className="text-data-bear text-[12px] font-mono font-bold mb-1">
              Something went wrong
            </div>
            <div className="text-text-muted text-[10px] font-mono">
              {this.state.error?.message}
            </div>
          </div>
        )
      )
    }
    return this.props.children
  }
}
