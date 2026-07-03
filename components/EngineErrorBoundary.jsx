'use client';

import { Component } from 'react';
import { menuBtnPrimary, menuCard, menuSub, menuTitleSm, overlay } from '@/lib/ui';

export class EngineErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className={overlay}>
          <div className={menuCard}>
            <h1 className={menuTitleSm}>Engine Error</h1>
            <p className={`${menuSub} mb-6 normal-case`}>
              {this.props.label || 'The 3D engine crashed.'}
            </p>
            <button
              type="button"
              className={menuBtnPrimary}
              onClick={() => {
                this.setState({ error: null });
                this.props.onRetry?.() ?? window.location.reload();
              }}
            >
              Reload World
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
