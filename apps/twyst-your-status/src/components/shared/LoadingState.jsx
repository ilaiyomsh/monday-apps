import React from 'react';
import { Loader } from '@vibe/core';

function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader size="medium" />
      <p className="mt-4 text-sm text-gray-500">{message}</p>
    </div>
  );
}

export default LoadingState;

