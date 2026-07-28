import { useState, useEffect, useCallback } from 'react';
import mondayService from '../services/mondayService';

export function useQuery(query, variables = {}, options = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { skip = false, onCompleted, onError } = options;

  const execute = useCallback(async (overrideVariables = {}) => {
    try {
      setLoading(true);
      setError(null);

      const result = await mondayService.query(query, {
        ...variables,
        ...overrideVariables,
      });

      setData(result);
      onCompleted?.(result);
      return result;
    } catch (err) {
      const errorMessage = err.message || 'Query failed';
      setError(errorMessage);
      onError?.(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [query, JSON.stringify(variables)]);

  useEffect(() => {
    if (!skip) {
      execute();
    }
  }, [execute, skip]);

  const refetch = useCallback((overrideVariables = {}) => {
    return execute(overrideVariables);
  }, [execute]);

  return { data, loading, error, refetch };
}

export function useMutation(mutation) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (variables = {}) => {
    try {
      setLoading(true);
      setError(null);

      const result = await mondayService.query(mutation, variables);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage = err.message || 'Mutation failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mutation]);

  return { execute, data, loading, error };
}

