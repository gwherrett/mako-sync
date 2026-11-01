import { useState, useCallback, useMemo, useRef } from 'react';
import { z } from 'zod';

interface ValidationField {
  value: string;
  error: string | null;
  touched: boolean;
  valid: boolean;
}

interface UseRealTimeValidationProps {
  schemas: Record<string, z.ZodType>;
  debounceMs?: number;
}

/** Returns the first validation message for `value`, or null when it passes. */
export const getFieldError = (schema: z.ZodType, value: string): string | null => {
  try {
    schema.parse(value);
    return null;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error.issues[0]?.message || 'Invalid value';
    }
    return 'Invalid value';
  }
};

export const useRealTimeValidation = ({ 
  schemas, 
  debounceMs = 300 
}: UseRealTimeValidationProps) => {
  const [fields, setFields] = useState<Record<string, ValidationField>>(() => {
    const initialFields: Record<string, ValidationField> = {};
    Object.keys(schemas).forEach(key => {
      initialFields[key] = {
        value: '',
        error: null,
        touched: false,
        valid: false,
      };
    });
    return initialFields;
  });

  const [debounceTimers, setDebounceTimers] = useState<Record<string, NodeJS.Timeout>>({});
  const isTyping = useRef<Record<string, boolean>>({});
  const fieldsRef = useRef<Record<string, ValidationField>>({});
  
  // Keep fieldsRef in sync with fields state
  fieldsRef.current = fields;

  const validateField = useCallback((fieldName: string, value: string) => {
    const schema = schemas[fieldName];
    if (!schema) return { error: null, valid: false };

    const error = getFieldError(schema, value);
    return { error, valid: error === null };
  }, [schemas]);

  const updateField = useCallback((fieldName: string, value: string, immediate = false) => {
    // Update value immediately without any validation to prevent re-renders during typing
    setFields(prev => ({
      ...prev,
      [fieldName]: {
        ...prev[fieldName],
        value,
        touched: true,
      }
    }));

    // Only validate if immediate (onBlur) - no debounced validation during typing
    if (immediate) {
      const validation = validateField(fieldName, value);
      setFields(prev => ({
        ...prev,
        [fieldName]: {
          ...prev[fieldName],
          error: validation.error,
          valid: validation.valid,
        }
      }));
    }
  }, [validateField]);

  const validateAllFields = useCallback(() => {
    const errors: Record<string, string> = {};
    let isValid = true;

    Object.entries(fields).forEach(([fieldName, field]) => {
      const schema = schemas[fieldName];
      if (field.touched && schema) {
        const error = getFieldError(schema, field.value);
        if (error) {
          errors[fieldName] = error;
          isValid = false;
        }
      }
    });

    return { errors, isValid };
  }, [fields, schemas]);

  const resetField = useCallback((fieldName: string) => {
    setFields(prev => ({
      ...prev,
      [fieldName]: {
        value: '',
        error: null,
        touched: false,
        valid: false,
      }
    }));

    if (debounceTimers[fieldName]) {
      clearTimeout(debounceTimers[fieldName]);
      setDebounceTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[fieldName];
        return newTimers;
      });
    }
  }, [debounceTimers]);

  const resetAllFields = useCallback(() => {
    Object.keys(fields).forEach(resetField);
  }, [fields, resetField]);

  // Create stable handlers using refs to avoid re-creation
  const getFieldProps = useCallback((fieldName: string) => {
    return {
      value: fields[fieldName]?.value || '',
      error: fields[fieldName]?.error,
      touched: fields[fieldName]?.touched || false,
      valid: fields[fieldName]?.valid || false,
      onChange: (value: string) => updateField(fieldName, value),
      onBlur: () => {
        // Use ref to get current value to avoid closure issues
        const currentValue = fieldsRef.current[fieldName]?.value || '';
        updateField(fieldName, currentValue, true);
      },
    };
  }, [updateField]); // Remove fields dependency to prevent re-creation

  const isFormValid = useMemo(() => {
    return Object.values(fields).every(field => 
      !field.touched || (field.touched && field.valid)
    );
  }, [fields]);

  const hasErrors = useMemo(() => {
    return Object.values(fields).some(field => 
      field.touched && field.error
    );
  }, [fields]);

  return {
    fields,
    updateField,
    validateAllFields,
    resetField,
    resetAllFields,
    getFieldProps,
    isFormValid,
    hasErrors,
  };
};

export default useRealTimeValidation;