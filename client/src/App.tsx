import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

import { BridgeProvider, type ClientConnection, type WalletConsumer, type AppConsumer } from 'bridge-sdk'
import { SessionCrypto } from '@tonconnect/protocol'

type ConnectState = 'idle' | 'connecting' | 'connected' | 'error'

function App() {
  const [state, setState] = useState<ConnectState>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [received, setReceived] = useState<unknown | null>(null)

  const appProviderRef = useRef<BridgeProvider<AppConsumer> | null>(null)
  const walletProviderRef = useRef<BridgeProvider<WalletConsumer> | null>(null)
  const appSessionRef = useRef<SessionCrypto | null>(null)
  const walletSessionRef = useRef<SessionCrypto | null>(null)

  const bridgeUrl = import.meta.env.VITE_BRIDGE_URL as string ?? 'https://walletbot.me/tonconnect-bridge/bridge'
  const heartbeatMs = Number(import.meta.env.VITE_HEARTBEAT_MS ?? '15000')

  const appendLog = useCallback((line: string) => {
    setLogs(prev => [new Date().toISOString() + ' ' + line, ...prev].slice(0, 200))
  }, [])

  const appListener = useCallback((event: any) => {
    appendLog(`app received ${event.lastEventId}: ${JSON.stringify(event)}`)
  }, [appendLog])

  const walletListener = useCallback((event: any) => {
    appendLog(`wallet received ${event.lastEventId}: ${JSON.stringify(event)}`)
    setReceived(event)
  }, [appendLog])

  const errorListener = useCallback((err: unknown) => {
    appendLog(`error: ${String(err)}`)
    setState('error')
  }, [appendLog])

  const connect = useCallback(async () => {
    if (appProviderRef.current || walletProviderRef.current) return
    if (!bridgeUrl) {
      appendLog('Missing VITE_BRIDGE_URL')
      return
    }
    setState('connecting')
    setReceived(null)
    try {
      const appSession = new SessionCrypto()
      const walletSession = new SessionCrypto()
      appSessionRef.current = appSession
      walletSessionRef.current = walletSession

      const appClients: ClientConnection[] = [{ session: appSession, clientId: walletSession.sessionId }]
      const walletClients: ClientConnection[] = [{ session: walletSession, clientId: appSession.sessionId }]

      const appProvider = await BridgeProvider.open<AppConsumer>({
        bridgeUrl,
        clients: appClients,
        listener: appListener as any,
        errorListener,
        onConnect: () => appendLog('app connecting...'),
        options: {
          heartbeatReconnectIntervalMs: heartbeatMs,
        }
      })

      const walletProvider = await BridgeProvider.open<WalletConsumer>({
        bridgeUrl,
        clients: walletClients,
        listener: walletListener as any,
        errorListener,
        onConnect: () => appendLog('wallet connecting...'),
        options: {
          heartbeatReconnectIntervalMs: heartbeatMs,
        }
      })

      appProviderRef.current = appProvider
      walletProviderRef.current = walletProvider
      setState('connected')
      appendLog('both connected')
    } catch (e) {
      appendLog('connect failed: ' + String(e))
      setState('error')
    }
  }, [appendLog, appListener, walletListener, bridgeUrl, errorListener, heartbeatMs])

  const disconnect = useCallback(async () => {
    await appProviderRef.current?.close()
    await walletProviderRef.current?.close()
    appProviderRef.current = null
    walletProviderRef.current = null
    appSessionRef.current = null
    walletSessionRef.current = null
    setState('idle')
    appendLog('disconnected')
  }, [appendLog])

  const reconnect = useCallback(async () => {
    const appProvider = appProviderRef.current
    const walletProvider = walletProviderRef.current
    const appSession = appSessionRef.current
    const walletSession = walletSessionRef.current
    if (!appProvider || !walletProvider || !appSession || !walletSession) {
      appendLog('reconnect skipped: missing providers or sessions')
      return
    }

    setState('connecting')
    setReceived(null)
    try {
      const appClients: ClientConnection[] = [{ session: appSession, clientId: walletSession.sessionId }]
      const walletClients: ClientConnection[] = [{ session: walletSession, clientId: appSession.sessionId }]

      await appProvider.restoreConnection(appClients)
      await walletProvider.restoreConnection(walletClients)

      setState('connected')
      appendLog('both reconnected')
    } catch (e) {
      appendLog('reconnect failed: ' + String(e))
      setState('error')
    }
  }, [appendLog])

  const sendBuy = useCallback(async () => {
    const appProvider = appProviderRef.current
    const appSession = appSessionRef.current
    const walletSession = walletSessionRef.current
    if (!appProvider || !appSession || !walletSession) return

    const msg = { method: 'sendTransaction', params: [''], id: '1' } as any
    try {
      await appProvider.send(msg, appSession, walletSession.sessionId, { attempts: 3 })
      appendLog('sent buy request')
    } catch (e) {
      appendLog('send failed: ' + String(e))
    }
  }, [appendLog])

  useEffect(() => {
    appendLog('bridge url: ' + (bridgeUrl ?? 'not set'))
  }, [appendLog, bridgeUrl])

  return (
    <div className="card" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2>Bridge Client Demo</h2>
      <p><strong>Status:</strong> {state}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={connect} disabled={state === 'connecting' || state === 'connected'}>Connect</button>
        <button onClick={disconnect} disabled={state !== 'connected'}>Disconnect</button>
        <button onClick={reconnect} disabled={state === 'connecting' || !appProviderRef.current || !walletProviderRef.current}>Reconnect</button>
        <button onClick={sendBuy} disabled={state !== 'connected'}>Send Buy</button>
      </div>

      <h3>Received (wallet)</h3>
      <pre style={{ height: 140, overflow: 'auto', background: '#111', color: '#9ad', padding: 12 }}>
        {received ? JSON.stringify(received, null, 2) : '-'}
      </pre>

      <h3>Logs</h3>
      <pre style={{ height: 280, overflow: 'auto', background: '#111', color: '#9ad', padding: 12 }}>
        {logs.join('\n')}
      </pre>
    </div>
  )
}

export default App
