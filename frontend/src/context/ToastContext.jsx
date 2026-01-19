import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((type, title, message, duration = 4000) => {
        const id = Date.now() + Math.random();
        const toast = { id, type, title, message };
        
        setToasts(prev => [...prev, toast]);

        if (duration > 0) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }

        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.map(t => 
            t.id === id ? { ...t, removing: true } : t
        ));
        
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 300);
    }, []);

    const showSuccess = useCallback((title, message) => {
        return addToast('success', title, message);
    }, [addToast]);

    const showError = useCallback((title, message) => {
        return addToast('error', title, message, 6000);
    }, [addToast]);

    const showWarning = useCallback((title, message) => {
        return addToast('warning', title, message);
    }, [addToast]);

    const showInfo = useCallback((title, message) => {
        return addToast('info', title, message);
    }, [addToast]);

    return (
        <ToastContext.Provider value={{ 
            toasts, 
            addToast, 
            removeToast,
            showSuccess,
            showError,
            showWarning,
            showInfo
        }}>
            {children}
        </ToastContext.Provider>
    );
};
