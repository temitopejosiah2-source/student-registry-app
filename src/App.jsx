import { useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, Interface, JsonRpcProvider, getAddress } from 'ethers'
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import './App.css'

const CONTRACT_ADDRESS = '0xa551cb621e1b7b2350049d842bf73C1c4e89a126'
const MULTICALL_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11'
const CHAIN_ID = 11155111
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'
const EXPLORER_API = 'https://eth-sepolia.blockscout.com/api'
const EXPLORER_ADDRESS = 'https://sepolia.etherscan.io/address/'
const REGISTRY_ABI = [
  'function getStudent(address _student) view returns (string name, uint256 age, string course)',
  'function register(string _name, uint256 _age, string _course)',
  'function registered(address) view returns (bool)',
]
const MULTICALL_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]
const registryInterface = new Interface(REGISTRY_ABI)
const multicallInterface = new Interface(MULTICALL_ABI)

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function prettyError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || 'Something went wrong.'
  if (message.includes('Student already registered')) return 'This wallet is already registered.'
  if (message.includes('User rejected')) return 'The wallet request was cancelled.'
  if (message.includes('Failed to fetch')) return 'Could not reach the Sepolia explorer. Try again shortly.'
  return message.replace(/^execution reverted: /, '')
}

async function multicall(provider, calls) {
  const output = []
  for (let index = 0; index < calls.length; index += 150) {
    const batch = calls.slice(index, index + 150)
    const data = multicallInterface.encodeFunctionData('aggregate3', [
      batch.map(({ data: callData }) => ({
        target: CONTRACT_ADDRESS,
        allowFailure: true,
        callData,
      })),
    ])
    const result = await provider.call({ to: MULTICALL_ADDRESS, data })
    output.push(...multicallInterface.decodeFunctionResult('aggregate3', result)[0])
  }
  return output
}

async function discoverStudentAddresses() {
  const addresses = new Set()
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(EXPLORER_API)
    url.search = new URLSearchParams({
      module: 'account',
      action: 'txlist',
      address: CONTRACT_ADDRESS,
      startblock: '0',
      endblock: '99999999',
      page: String(page),
      offset: '1000',
      sort: 'asc',
    }).toString()
    const response = await fetch(url)
    if (!response.ok) throw new Error('Could not reach the Sepolia explorer.')
    const payload = await response.json()
    if (!Array.isArray(payload.result)) throw new Error(payload.result || 'Explorer returned an invalid response.')
    for (const transaction of payload.result) {
      if (transaction.from) addresses.add(getAddress(transaction.from))
    }
    if (payload.result.length < 1000) break
  }
  return [...addresses]
}

function App() {
  const [account, setAccount] = useState('')
  const [networkReady, setNetworkReady] = useState(false)
  const [student, setStudent] = useState(null)
  const [isRegistered, setIsRegistered] = useState(false)
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [loadingAccount, setLoadingAccount] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({ name: '', age: '', course: '' })
  const [lastUpdated, setLastUpdated] = useState(null)

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return students
    return students.filter((entry) =>
      [entry.name, entry.course, entry.address].some((value) => value.toLowerCase().includes(query)),
    )
  }, [search, students])

  async function refreshStudentList(connectedAddress = account) {
    setLoadingStudents(true)
    setError('')
    try {
      const provider = new JsonRpcProvider(RPC_URL)
      const discovered = await discoverStudentAddresses()
      const candidates = new Set(discovered)
      if (connectedAddress) candidates.add(getAddress(connectedAddress))
      const addresses = [...candidates]
      if (!addresses.length) {
        setStudents([])
        setLastUpdated(new Date())
        return
      }

      const registrationCalls = addresses.map((address) => ({
        address,
        data: registryInterface.encodeFunctionData('registered', [address]),
      }))
      const registrationResults = await multicall(provider, registrationCalls)
      const registeredAddresses = addresses.filter((_, index) => {
        const response = registrationResults[index]
        if (!response.success) return false
        return registryInterface.decodeFunctionResult('registered', response.returnData)[0]
      })

      const detailCalls = registeredAddresses.map((address) => ({
        address,
        data: registryInterface.encodeFunctionData('getStudent', [address]),
      }))
      const detailResults = await multicall(provider, detailCalls)
      const records = detailResults.flatMap((response, index) => {
        if (!response.success) return []
        const [name, age, course] = registryInterface.decodeFunctionResult('getStudent', response.returnData)
        return [{ address: registeredAddresses[index], name, age: Number(age), course }]
      })
      setStudents(records)
      setLastUpdated(new Date())
    } catch (caughtError) {
      setError(prettyError(caughtError))
    } finally {
      setLoadingStudents(false)
    }
  }

  async function refreshAccount(address = account) {
    if (!address) return
    setLoadingAccount(true)
    try {
      const provider = new JsonRpcProvider(RPC_URL)
      const result = await multicall(provider, [
        { address, data: registryInterface.encodeFunctionData('registered', [address]) },
      ])
      const registered = result[0].success && registryInterface.decodeFunctionResult('registered', result[0].returnData)[0]
      setIsRegistered(registered)
      if (registered) {
        const details = await multicall(provider, [
          { address, data: registryInterface.encodeFunctionData('getStudent', [address]) },
        ])
        if (details[0].success) {
          const [name, age, course] = registryInterface.decodeFunctionResult('getStudent', details[0].returnData)
          setStudent({ name, age: Number(age), course })
        }
      } else {
        setStudent(null)
      }
    } catch (caughtError) {
      setError(prettyError(caughtError))
    } finally {
      setLoadingAccount(false)
    }
  }

  async function connectWallet() {
    setError('')
    setNotice('')
    if (!window.ethereum) {
      setError('A browser wallet such as MetaMask is needed to register a student.')
      return
    }
    try {
      const provider = new BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      let network = await provider.getNetwork()
      if (Number(network.chainId) !== CHAIN_ID) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }],
        })
        network = await provider.getNetwork()
      }
      if (Number(network.chainId) !== CHAIN_ID) throw new Error('Please switch your wallet to Sepolia.')
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      setAccount(address)
      setNetworkReady(true)
      await refreshAccount(address)
      await refreshStudentList(address)
    } catch (caughtError) {
      setError(prettyError(caughtError))
    }
  }

  async function registerStudent(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!account) {
      setError('Connect a Sepolia wallet before registering.')
      return
    }
    if (!form.name.trim() || !form.course.trim() || !Number.isInteger(Number(form.age)) || Number(form.age) < 1 || Number(form.age) > 150) {
      setError('Enter a name, course, and a valid age between 1 and 150.')
      return
    }
    setRegistering(true)
    try {
      const provider = new BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()
      if (Number(network.chainId) !== CHAIN_ID) throw new Error('Switch your wallet to Sepolia before submitting.')
      const signer = await provider.getSigner()
      const registration = new Contract(CONTRACT_ADDRESS, REGISTRY_ABI, signer)
      const transaction = await registration.register(form.name.trim(), Number(form.age), form.course.trim())
      setNotice('Registration submitted. Waiting for the Sepolia confirmation...')
      await transaction.wait()
      setForm({ name: '', age: '', course: '' })
      setNotice('Student registered successfully. Your profile is now on-chain.')
      await refreshAccount(account)
      await refreshStudentList(account)
    } catch (caughtError) {
      setError(prettyError(caughtError))
    } finally {
      setRegistering(false)
    }
  }

  async function copyAddress() {
    if (!account) return
    await navigator.clipboard.writeText(account)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      if (!cancelled) refreshStudentList('')
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [])

  useEffect(() => {
    if (!window.ethereum) return undefined
    const handleAccountsChanged = async (accounts) => {
      const address = accounts[0] || ''
      setAccount(address)
      setStudent(null)
      setIsRegistered(false)
      if (address) {
        await refreshAccount(address)
        await refreshStudentList(address)
      }
    }
    const handleChainChanged = async (chainId) => {
      setNetworkReady(Number(chainId) === CHAIN_ID)
      if (Number(chainId) === CHAIN_ID && account) await refreshAccount(account)
    }
    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [account])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Campus Ledger home">
          <span className="brand-mark"><GraduationCap size={23} strokeWidth={2.1} /></span>
          <span className="brand-name">campus<span>ledger</span></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><BookOpen size={17} /> Overview</a>
          <a className="nav-item" href="#directory"><GraduationCap size={17} /> Student directory</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="network-card">
            <span className="network-dot" />
            <div><strong>Sepolia testnet</strong><small>Ethereum network</small></div>
            <ChevronDown size={15} />
          </div>
          <a className="contract-link" href={`${EXPLORER_ADDRESS}${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
            <span><ShieldCheck size={16} /> Registry contract</span><ExternalLink size={14} />
          </a>
          <div className="sidebar-foot">STUDENT REGISTRY <span>v1.0</span></div>
        </div>
      </aside>

      <main className="main-area" id="overview">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-actions">
            <div className={`network-chip ${networkReady ? 'is-live' : ''}`}><span /> Sepolia</div>
            {account ? (
              <button className="wallet-button connected" type="button" onClick={copyAddress} title="Copy wallet address">
                {copied ? <Check size={16} /> : <Wallet size={16} />}<span>{copied ? 'Copied' : shortAddress(account)}</span>
              </button>
            ) : (
              <button className="wallet-button" type="button" onClick={connectWallet}><Wallet size={16} /> Connect wallet</button>
            )}
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-intro">
            <div className="intro-copy">
              <div className="eyebrow"><span /> ON-CHAIN STUDENT RECORDS</div>
              <h1>Student registry</h1>
              <p>A shared record of our learning community, secured on Ethereum.</p>
            </div>
            <a className="explorer-button" href={`${EXPLORER_ADDRESS}${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
              View on explorer <ArrowUpRight size={16} />
            </a>
          </section>

          {(error || notice) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role="status">{error || notice}<button type="button" onClick={() => { setError(''); setNotice('') }} aria-label="Dismiss message">×</button></div>}

          <section className="summary-grid" aria-label="Registry summary">
            <article className="summary-card summary-total">
              <div className="summary-top"><span className="summary-icon green"><GraduationCap size={18} /></span><span className="summary-caption">NETWORK RECORDS</span></div>
              <div className="summary-number">{loadingStudents && students.length === 0 ? <LoaderCircle className="spin" size={26} /> : students.length}</div>
              <div className="summary-foot"><span>Verified students</span><span className="live-indicator"><i /> LIVE</span></div>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span className="summary-icon coral"><ShieldCheck size={18} /></span><span className="summary-caption">YOUR RECORD</span></div>
              <div className="summary-number summary-status">{loadingAccount ? <LoaderCircle className="spin" size={24} /> : account ? (isRegistered ? 'Registered' : 'Not registered') : 'Connect wallet'}</div>
              <div className="summary-foot"><span>{account ? (isRegistered ? 'Profile confirmed on-chain' : 'Ready to create your profile') : 'Check your enrollment status'}</span></div>
            </article>
            <article className="summary-card summary-contract">
              <div className="summary-top"><span className="summary-icon blue"><ArrowDownToLine size={18} /></span><span className="summary-caption">NETWORK</span></div>
              <div className="summary-number summary-status">Sepolia</div>
              <div className="summary-foot"><span>Chain ID 11155111</span><a href={`${EXPLORER_ADDRESS}${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contract <ArrowUpRight size={12} /></a></div>
            </article>
          </section>

          <section className="workspace-grid">
            <article className="panel profile-panel">
              <div className="panel-heading">
                <div><div className="section-kicker">YOUR PLACE IN THE REGISTRY</div><h2>My student profile</h2></div>
                {account && <button className="icon-button" type="button" onClick={() => refreshAccount()} disabled={loadingAccount} aria-label="Refresh student profile" title="Refresh profile"><RefreshCw className={loadingAccount ? 'spin' : ''} size={16} /></button>}
              </div>
              {account ? (
                isRegistered && student ? (
                  <div className="profile-record">
                    <div className="profile-avatar">{student.name.trim().charAt(0).toUpperCase()}</div>
                    <div className="profile-name"><h3>{student.name}</h3><span><Check size={13} /> VERIFIED ON SEPOLIA</span></div>
                    <div className="record-fields">
                      <div><span>WALLET ADDRESS</span><a href={`${EXPLORER_ADDRESS}${account}`} target="_blank" rel="noreferrer">{shortAddress(account)} <ExternalLink size={13} /></a></div>
                      <div><span>AGE</span><strong>{student.age} years</strong></div>
                      <div><span>COURSE OF STUDY</span><strong>{student.course}</strong></div>
                    </div>
                    <div className="profile-chain"><ShieldCheck size={15} /> This profile is stored on the Sepolia blockchain.</div>
                  </div>
                ) : (
                  <div className="profile-empty">
                    <div className="empty-symbol"><GraduationCap size={24} /></div>
                    <h3>{loadingAccount ? 'Checking your record' : 'No student profile yet'}</h3>
                    <p>{loadingAccount ? 'Reading your wallet against the registry.' : 'Your connected wallet is not registered. Add your student details to join the directory.'}</p>
                    {!loadingAccount && <a href="#register">Register below <ArrowDownToLine size={15} /></a>}
                  </div>
                )
              ) : (
                <div className="profile-empty">
                  <div className="empty-symbol"><Wallet size={22} /></div>
                  <h3>Connect to view your record</h3>
                  <p>Your wallet address is used to check whether a student profile is registered.</p>
                  <button className="text-action" type="button" onClick={connectWallet}>Connect wallet <ArrowUpRight size={15} /></button>
                </div>
              )}
            </article>

            <article className="panel register-panel" id="register">
              <div className="panel-heading">
                <div><div className="section-kicker">JOIN THE COMMUNITY</div><h2>Register a student</h2></div>
                <span className="register-mark"><GraduationCap size={19} /></span>
              </div>
              {isRegistered ? (
                <div className="already-registered"><span className="registered-check"><Check size={17} /></span><strong>Already registered</strong><p>This wallet already has a student profile. The contract allows one profile per address.</p></div>
              ) : (
                <form className="register-form" onSubmit={registerStudent}>
                  <label>Full name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Amara Okafor" maxLength={80} required disabled={!account || registering} /></label>
                  <div className="form-row">
                    <label>Age<input type="number" min="1" max="150" value={form.age} onChange={(event) => setForm({ ...form, age: event.target.value })} placeholder="21" required disabled={!account || registering} /></label>
                    <label>Course of study<input value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value })} placeholder="e.g. Computer Science" maxLength={80} required disabled={!account || registering} /></label>
                  </div>
                  <div className="form-note"><CircleHelp size={14} /><span>Details are public and permanent once written to the blockchain.</span></div>
                  <button className="submit-button" type="submit" disabled={!account || registering || isRegistered}>
                    {registering ? <><LoaderCircle className="spin" size={16} /> Confirm in wallet...</> : account ? <>Register student <ArrowUpRight size={16} /></> : <><Wallet size={16} /> Connect wallet to register</>}
                  </button>
                  <div className="fee-note"><span /> Requires Sepolia ETH for gas fees</div>
                </form>
              )}
            </article>
          </section>

          <section className="panel directory-panel" id="directory">
            <div className="directory-head">
              <div className="panel-heading directory-title"><div><div className="section-kicker">THE COMMUNITY</div><h2>Registered students <span className="count-pill">{students.length}</span></h2></div></div>
              <div className="directory-actions">
                <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students" aria-label="Search students" /></label>
                <button className="refresh-button" type="button" onClick={() => refreshStudentList()} disabled={loadingStudents} title="Refresh student list"><RefreshCw className={loadingStudents ? 'spin' : ''} size={16} /><span>Refresh</span></button>
              </div>
            </div>
            <div className="data-note"><span className="data-note-dot" /><span>Student addresses are discovered from Sepolia contract transactions; profiles are verified with on-chain Multicall3 reads.</span></div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>STUDENT</th><th>WALLET ADDRESS</th><th>AGE</th><th>COURSE OF STUDY</th><th aria-label="Explorer link" /></tr></thead>
                <tbody>
                  {loadingStudents && students.length === 0 ? (
                    <tr><td colSpan="5" className="table-message"><LoaderCircle className="spin" size={18} /> Loading on-chain records...</td></tr>
                  ) : filteredStudents.length ? filteredStudents.map((entry, index) => (
                    <tr key={entry.address} className="student-row" style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}>
                      <td><div className="student-name"><span className={`student-avatar avatar-${index % 5}`}>{entry.name.trim().charAt(0).toUpperCase()}</span><strong>{entry.name}</strong></div></td>
                      <td><a className="address-cell" href={`${EXPLORER_ADDRESS}${entry.address}`} target="_blank" rel="noreferrer">{shortAddress(entry.address)} <ExternalLink size={12} /></a></td>
                      <td>{entry.age}</td><td>{entry.course}</td>
                      <td><a className="row-link" href={`${EXPLORER_ADDRESS}${entry.address}`} target="_blank" rel="noreferrer" aria-label={`Open ${entry.name} wallet on Etherscan`}><ArrowUpRight size={15} /></a></td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" className="table-message">{search ? 'No students match your search.' : error ? 'Student records could not be loaded.' : 'No registered students found yet.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="directory-footer"><span>Showing <strong>{filteredStudents.length}</strong> of <strong>{students.length}</strong> verified records</span><span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for first sync'}</span></div>
          </section>

          <footer className="page-footer"><span>Campus Ledger <span className="footer-sep">/</span> Sepolia student registry</span><a href={`${EXPLORER_ADDRESS}${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contract on Etherscan <ExternalLink size={12} /></a><span className="footer-address">{shortAddress(CONTRACT_ADDRESS)} <button type="button" onClick={() => navigator.clipboard.writeText(CONTRACT_ADDRESS)} aria-label="Copy contract address"><Copy size={12} /></button></span></footer>
        </div>
      </main>
    </div>
  )
}

export default App
