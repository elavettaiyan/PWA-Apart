import { X } from 'lucide-react';
import { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-on-surface/30 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-surface-container-lowest rounded-2xl w-full ${sizes[size]} max-h-[90vh] flex flex-col editorial-shadow`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/15">
          <h2 className="text-lg font-headline font-bold text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-container transition"
          >
            <X className="w-5 h-5 text-outline" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
