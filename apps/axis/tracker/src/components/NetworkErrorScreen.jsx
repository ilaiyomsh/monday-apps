import React from 'react';
import loaderStyles from './StopwatchLoader/StopwatchLoader.module.css';

const wrapperStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100dvh',
  background: 'var(--color-bg-primary)',
  gap: '16px',
  padding: '24px',
  textAlign: 'center'
};

const titleStyle = {
  fontSize: '20px',
  fontWeight: 600,
  color: 'var(--color-text)',
  margin: 0
};

const bodyStyle = {
  fontSize: '14px',
  color: 'var(--color-text-secondary)',
  maxWidth: '420px',
  lineHeight: 1.5,
  margin: 0
};

const buttonStyle = {
  marginTop: '8px',
  padding: '8px 24px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--color-text-inverse)',
  background: 'var(--color-primary)',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer'
};

const buttonDisabledStyle = {
  ...buttonStyle,
  background: 'var(--color-text-disabled-soft)',
  cursor: 'not-allowed'
};

export default function NetworkErrorScreen({ onRetry, isLoading }) {
  return (
    <div style={wrapperStyle} dir="ltr" lang="en">
      <h1 style={titleStyle}>Couldn&apos;t load settings due to a network issue</h1>
      <p style={bodyStyle}>
        We couldn&apos;t load your settings because of a network or connectivity issue
        to monday servers. We already tried one automatic silent refresh. Please check
        your internet connection or VPN and try again.
      </p>
      <button
        type="button"
        style={isLoading ? buttonDisabledStyle : buttonStyle}
        onClick={onRetry}
        disabled={isLoading}
      >
        {isLoading ? 'Retrying…' : 'Retry'}
      </button>
      <p className={loaderStyles.brandText}>Powered by Twyst</p>
    </div>
  );
}
