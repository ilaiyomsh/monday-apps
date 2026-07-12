import React from 'react';
import { Loader } from '@vibe/core';

function LoadingState({ message = 'טוען...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader size="medium" />
      <p
        className="mt-4 text-sm"
        style={{ color: 'var(--secondary-text-color, #676879)' }}
      >
        {message}
      </p>
    </div>
  );
}

export default LoadingState;
