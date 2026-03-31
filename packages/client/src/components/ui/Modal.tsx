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
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <div className="fixed inset-0 bg-[#1a1f36]/20 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl w-full ${sizes[size]} max-h-[90vh] flex flex-col`} style={{ boxShadow: '0 8px 40px -8px rgba(23,37,84,0.15)' }}>
        <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-[#edf1f6] sm:px-6">
          <h2 className="text-base font-headline font-bold text-[#1a1f36] sm:text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="p-2.5 -mr-1.5 rounded-lg hover:bg-[#f5f7fa] transition touch-manipulation"
          >
            <X className="w-5 h-5 text-[#8892a4]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
