import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { Link } from 'react-router-dom';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [analyses, setAnalyses] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/analyses')
      .then(res => setAnalyses(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setAnalyses([res.data, ...analyses]);
      setSelectedFile(null);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const downloadReport = async (id) => {
    try {
      const response = await axios.get(`/api/analyses/${id}/report`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `analysis-report-${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error(err);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return '#4ade80';
    if (score >= 60) return '#fbbf24';
    return '#f87171';
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <header style={{
        background: 'white',
        padding: '20px 40px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{ margin: 0, color: '#333' }}>Code Analyzer - AI Powered</h1>
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>Welcome, {user?.name}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Link to="/" style={{
            padding: '10px 20px',
            background: '#e5e7eb',
            color: '#333',
            borderRadius: '6px',
            textDecoration: 'none'
          }}>Code to ZIP</Link>
          <button onClick={logout} style={{
            padding: '10px 20px',
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}>Logout</button>
        </div>
      </header>

      <main style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{
          background: 'white',
          padding: '30px',
          borderRadius: '12px',
          marginBottom: '30px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{ marginTop: 0, color: '#333' }}>Upload Code for Analysis</h2>
          <p style={{ color: '#666' }}>Upload a single file or a ZIP file of your project</p>
          
          <div style={{ marginTop: '20px' }}>
            <input
              type="file"
              accept=".zip,.js,.jsx,.ts,.tsx,.py,.html,.css"
              onChange={handleFileUpload}
              disabled={uploading}
              style={{ fontSize: '16px' }}
            />
            {uploading && <p style={{ color: '#666', marginTop: '10px' }}>Analyzing...</p>}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '30px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{ marginTop: 0, color: '#333' }}>Your Analyses</h2>
          
          {loading ? (
            <p style={{ color: '#666' }}>Loading...</p>
          ) : analyses.length === 0 ? (
            <p style={{ color: '#666' }}>No analyses yet. Upload a file to get started!</p>
          ) : (
            <div style={{ display: 'grid', gap: '20px' }}>
              {analyses.map(analysis => (
                <div key={analysis.id} style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <span style={{
                        fontSize: '24px',
                        fontWeight: 'bold',
                        color: getScoreColor(analysis.results.overallScore)
                      }}>
                        {analysis.results.overallScore}/100
                      </span>
                      <div>
                        <p style={{ margin: 0, fontWeight: '500' }}>
                          {analysis.files.length} file{analysis.files.length !== 1 ? 's' : ''} analyzed
                        </p>
                        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
                          {new Date(analysis.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => downloadReport(analysis.id)} style={{
                    padding: '10px 20px',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}>Download Report</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
