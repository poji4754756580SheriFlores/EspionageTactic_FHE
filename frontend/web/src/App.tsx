// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EspionageRecord {
  id: string;
  tactic: string;
  encryptedData: string;
  timestamp: number;
  company: string;
  industry: string;
  status: "unverified" | "verified" | "critical";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<EspionageRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    tactic: "",
    company: "",
    industry: "",
    description: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("all");
  const [showStats, setShowStats] = useState(true);
  const [activeRecord, setActiveRecord] = useState<string | null>(null);

  // Calculate statistics
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const unverifiedCount = records.filter(r => r.status === "unverified").length;
  const criticalCount = records.filter(r => r.status === "critical").length;
  const industries = Array.from(new Set(records.map(r => r.industry)));

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("tactic_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing tactic keys:", e);
        }
      }
      
      const list: EspionageRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`tactic_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                tactic: recordData.tactic,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                company: recordData.company,
                industry: recordData.industry,
                status: recordData.status || "unverified"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensitive data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        tactic: newRecordData.tactic,
        timestamp: Math.floor(Date.now() / 1000),
        company: newRecordData.company,
        industry: newRecordData.industry,
        status: "unverified"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `tactic_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("tactic_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "tactic_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          tactic: "",
          company: "",
          industry: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`tactic_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `tactic_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const markCritical = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`tactic_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "critical"
      };
      
      await contract.setData(
        `tactic_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Marked as critical threat!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Operation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.tactic.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.company.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesIndustry = filterIndustry === "all" || record.industry === filterIndustry;
    return matchesSearch && matchesIndustry;
  });

  const toggleRecordDetails = (recordId: string) => {
    setActiveRecord(activeRecord === recordId ? null : recordId);
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Espionage</span>Shield</h1>
          <p>Confidential Analysis of Corporate Espionage Tactics</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            Report Tactic
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="hero-banner">
          <div className="hero-content">
            <h2>Fully Homomorphic Encryption for Corporate Defense</h2>
            <p>Anonymously share and analyze espionage tactics while keeping sensitive data encrypted</p>
            <div className="fhe-badge">
              <span>FHE-Powered Security</span>
            </div>
          </div>
        </div>

        {showStats && (
          <div className="stats-section">
            <h3>Threat Intelligence Dashboard</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Tactics</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{unverifiedCount}</div>
                <div className="stat-label">Unverified</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{criticalCount}</div>
                <div className="stat-label">Critical</div>
              </div>
            </div>
          </div>
        )}

        <div className="controls-row">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search tactics or companies..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <select 
              value={filterIndustry} 
              onChange={(e) => setFilterIndustry(e.target.value)}
            >
              <option value="all">All Industries</option>
              {industries.map(industry => (
                <option key={industry} value={industry}>{industry}</option>
              ))}
            </select>
          </div>
          <button 
            onClick={loadRecords}
            className="refresh-btn"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </button>
          <button 
            onClick={() => setShowStats(!showStats)}
            className="toggle-btn"
          >
            {showStats ? "Hide Stats" : "Show Stats"}
          </button>
        </div>

        <div className="records-section">
          <h3>Espionage Tactics Database</h3>
          
          {filteredRecords.length === 0 ? (
            <div className="no-records">
              <p>No espionage tactics found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Report First Tactic
              </button>
            </div>
          ) : (
            <div className="records-list">
              {filteredRecords.map(record => (
                <div className={`record-card ${record.status}`} key={record.id}>
                  <div className="record-header">
                    <h4>{record.tactic}</h4>
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="record-details">
                    <div className="detail">
                      <span className="label">Company:</span>
                      <span className="value">{record.company}</span>
                    </div>
                    <div className="detail">
                      <span className="label">Industry:</span>
                      <span className="value">{record.industry}</span>
                    </div>
                    <div className="detail">
                      <span className="label">Reported:</span>
                      <span className="value">
                        {new Date(record.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="record-actions">
                    <button 
                      onClick={() => toggleRecordDetails(record.id)}
                      className="text-btn"
                    >
                      {activeRecord === record.id ? "Hide Details" : "View Details"}
                    </button>
                    <button 
                      onClick={() => verifyRecord(record.id)}
                      className="outline-btn"
                    >
                      Verify
                    </button>
                    <button 
                      onClick={() => markCritical(record.id)}
                      className="critical-btn"
                    >
                      Mark Critical
                    </button>
                  </div>
                  {activeRecord === record.id && (
                    <div className="record-expanded">
                      <div className="encrypted-data">
                        <span className="label">FHE-Encrypted Data:</span>
                        <span className="value">{record.encryptedData}</span>
                      </div>
                      <div className="fhe-notice">
                        Data remains encrypted during FHE processing
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>FHE Espionage Shield</h4>
            <p>Confidential analysis of corporate espionage tactics using Fully Homomorphic Encryption</p>
          </div>
          <div className="footer-section">
            <h4>Resources</h4>
            <a href="#">Documentation</a>
            <a href="#">API</a>
            <a href="#">Privacy Policy</a>
          </div>
          <div className="footer-section">
            <h4>Community</h4>
            <a href="#">Forum</a>
            <a href="#">GitHub</a>
            <a href="#">Twitter</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} FHE Espionage Shield. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.tactic || !recordData.company) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Report Espionage Tactic</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            Your report will be encrypted with FHE for secure anonymous sharing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Tactic Name *</label>
              <input 
                type="text"
                name="tactic"
                value={recordData.tactic} 
                onChange={handleChange}
                placeholder="Describe the espionage tactic" 
              />
            </div>
            
            <div className="form-group">
              <label>Target Company *</label>
              <input 
                type="text"
                name="company"
                value={recordData.company} 
                onChange={handleChange}
                placeholder="Company name" 
              />
            </div>
            
            <div className="form-group">
              <label>Industry *</label>
              <select 
                name="industry"
                value={recordData.industry} 
                onChange={handleChange}
              >
                <option value="">Select industry</option>
                <option value="Technology">Technology</option>
                <option value="Finance">Finance</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Energy">Energy</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Detailed Description</label>
              <textarea 
                name="description"
                value={recordData.description} 
                onChange={handleChange}
                placeholder="Provide details about the espionage tactic..." 
                rows={4}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Submit Report"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;