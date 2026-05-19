import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { API_URL } from '../../lib/userApi'
import './Chatbot.css'

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "👋 Hello! I am your GoalFlow AI Assistant. Ask me anything about our company's active departments, users, roles, manager reporting structure, or strategic goals! How can I help you today?"
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  
  const messagesEndRef = useRef(null)

  // Scroll to bottom whenever messages list changes or typing starts
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  // Get active session token for backend request
  async function getHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      'Authorization': session ? `Bearer ${session.access_token}` : ''
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const headers = await getHeaders()
      
      // We pass the full message history to Groq for context
      const chatHistory = [...messages, { role: 'user', content: userMessage }]
        .filter(m => m.role !== 'system') // ensure system instructions aren't duplicated
        .map(m => ({ role: m.role, content: m.content }))

      const response = await fetch(`${API_URL}/api/chatbot/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: chatHistory })
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.error || 'Failed to communicate with AI.')
      }

      const data = await response.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])

    } catch (err) {
      console.error('Chatbot request error:', err)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Sorry, I encountered an error: ${err.message}. Please make sure GROQ_API_KEY is configured in your backend .env file.`
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`chatbot-container ${isOpen ? 'open' : 'closed'}`}>
      
      {/* ── Chat Bubble Trigger ── */}
      <button 
        className="chatbot-trigger" 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle AI Assistant"
      >
        {isOpen ? (
          <span className="close-icon">✕</span>
        ) : (
          <div className="trigger-content">
            <span className="bot-icon">🤖</span>
            <span className="trigger-pulse"></span>
          </div>
        )}
      </button>

      {/* ── Chat Window ── */}
      {isOpen && (
        <div className="chatbot-window">
          {/* Header */}
          <div className="chatbot-header">
            <div className="header-info">
              <span className="header-status-dot"></span>
              <div>
                <h3>GoalFlow AI Assistant</h3>
                <p>Powered by Llama 3.3 (Groq)</p>
              </div>
            </div>
            <button className="header-close-btn" onClick={() => setIsOpen(false)}>✕</button>
          </div>

          {/* Messages */}
          <div className="chatbot-messages">
            {messages.map((m, index) => (
              <div key={index} className={`message-wrapper ${m.role}`}>
                <div className="message-avatar">
                  {m.role === 'assistant' ? '🤖' : '👤'}
                </div>
                <div className="message-bubble">
                  {m.content}
                </div>
              </div>
            ))}
            
            {loading && (
              <div className="message-wrapper assistant loading">
                <div className="message-avatar">🤖</div>
                <div className="message-bubble typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form className="chatbot-input-form" onSubmit={handleSend}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about goals, users, or departments..."
              disabled={loading}
              autoFocus
            />
            <button type="submit" className="send-btn" disabled={loading || !input.trim()}>
              {loading ? (
                <div className="button-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              )}
            </button>
          </form>

        </div>
      )}

    </div>
  )
}
