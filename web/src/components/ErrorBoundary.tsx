import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error.message, info.componentStack?.slice(0, 500));
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-screen bg-forge-bg text-forge-text">
          <div className="text-center space-y-4 max-w-lg p-8">
            <div className="text-forge-red text-lg font-bold">页面出错了</div>
            <pre className="text-xs text-forge-text2/60 bg-forge-surface p-4 rounded-lg text-left overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="px-4 py-2 rounded-lg bg-forge-cyan/20 text-forge-cyan border border-forge-cyan/30 hover:bg-forge-cyan/30 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
