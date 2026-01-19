import React from 'react';
import { useToast } from '../context/ToastContext';

const ToastContainer = () => {
    const { toasts, removeToast } = useToast();

    const getIcon = (type) => {
        switch (type) {
            case 'success': return 'fa-check-circle';
            case 'error': return 'fa-times-circle';
            case 'warning': return 'fa-exclamation-triangle';
            case 'info': return 'fa-info-circle';
            default: return 'fa-info-circle';
        }
    };

    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <div 
                    key={toast.id} 
                    className={`toast ${toast.type} ${toast.removing ? 'removing' : ''}`}
                >
                    <i className={`toast-icon fas ${getIcon(toast.type)}`}></i>
                    <div className="toast-content">
                        <div className="toast-title">{toast.title}</div>
                        {toast.message && (
                            <div className="toast-message">{toast.message}</div>
                        )}
                    </div>
                    <button 
                        className="toast-close"
                        onClick={() => removeToast(toast.id)}
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ToastContainer;
