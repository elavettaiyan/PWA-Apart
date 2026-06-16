import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, Download, FileSpreadsheet } from 'lucide-react';
import api from '@/lib/api';
import type { BulkUploadResult } from '@/types/flats';

interface BulkUploadFormProps {
  onSuccess: () => void;
  onLimitReached: () => void;
}

export function BulkUploadForm({ onSuccess, onLimitReached }: BulkUploadFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<BulkUploadResult | null>(null);

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/flats/bulk-upload/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flat_upload_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Template downloaded!');
    } catch (error: any) {
      toast.error('Failed to download template');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.endsWith('.xlsx') && !selected.name.endsWith('.xls')) {
        toast.error('Please upload an Excel file (.xlsx or .xls)');
        return;
      }
      setFile(selected);
      setResults(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const response = await api.post<BulkUploadResult>('/flats/bulk-upload', buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
      setResults(response.data);
      if (response.data.results?.some((r: any) => /limit|capacity/i.test(r.error || ''))) {
        onLimitReached();
      }
      if (response.data.created > 0) {
        toast.success(`${response.data.created} flats created successfully!`);
      }
      if (response.data.errors > 0) {
        toast.error(`${response.data.errors} rows had errors. Check details below.`);
      }
      if (response.data.created > 0) {
        setTimeout(onSuccess, 2000);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Download Template */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
        <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Step 1: Download Template
        </h3>
        <p className="text-xs text-slate-700 mb-3">
          Download the Excel template, fill in your flat details, and upload it back.
          Owner accounts will be auto-created with phone number as default password.
        </p>
        <button onClick={handleDownloadTemplate} className="btn-secondary text-sm">
          <Download className="w-4 h-4" /> Download Template
        </button>
      </div>

      {/* Step 2: Upload File */}
      <div className="p-4 bg-surface-container-low border border-outline-variant/15 rounded-xl">
        <h3 className="text-sm font-semibold text-on-surface mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Step 2: Upload Filled Excel
        </h3>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-outline-variant rounded-lg p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-container/50 transition"
        >
          {file ? (
            <div>
              <FileSpreadsheet className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="text-sm font-medium text-on-surface">{file.name}</p>
              <p className="text-xs text-on-surface-variant mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              <p className="text-xs text-primary mt-2">Click to change file</p>
            </div>
          ) : (
            <div>
              <Upload className="w-8 h-8 text-outline mx-auto mb-2" />
              <p className="text-sm text-on-surface-variant">Click to select Excel file</p>
              <p className="text-xs text-outline mt-1">Supports .xlsx and .xls files</p>
            </div>
          )}
        </div>

        {file && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="btn-primary"
            >
              {uploading ? 'Processing...' : 'Upload & Create Flats'}
            </button>
          </div>
        )}
      </div>

      {/* Step 3: Results */}
      {results && (
        <div className="p-4 bg-white border border-outline-variant/15 rounded-xl">
          <h3 className="text-sm font-semibold text-on-surface mb-3">Upload Results</h3>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-surface-container-low rounded-lg text-center">
              <p className="text-lg font-bold text-on-surface">{results.total}</p>
              <p className="text-xs text-on-surface-variant">Total Rows</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg text-center">
              <p className="text-lg font-bold text-emerald-700">{results.created}</p>
              <p className="text-xs text-emerald-600">Created</p>
            </div>
            <div className="p-3 bg-error-container rounded-lg text-center">
              <p className="text-lg font-bold text-on-error-container">{results.errors}</p>
              <p className="text-xs text-on-error-container">Errors</p>
            </div>
          </div>

          {results.results && results.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-outline-variant/15">
                  <tr>
                    <th className="text-left p-2">Row</th>
                    <th className="text-left p-2">Flat</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.slice(0, 10).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-outline-variant/10">
                      <td className="p-2 text-on-surface">{r.row}</td>
                      <td className="p-2 text-on-surface">{r.flatNumber}</td>
                      <td className="p-2">
                        <span className={`badge ${r.status === 'created' ? 'badge-success' : 'badge-neutral'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="p-2 text-error">{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.results.length > 10 && (
                <p className="text-xs text-on-surface-variant mt-2">...and {results.results.length - 10} more rows</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
