import LiquidGlass from 'liquid-glass-react'

function App() {
  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <LiquidGlass 
        displacementScale={80} 
        blurAmount={0.15} 
        cornerRadius={32}
        onClick={() => alert('Clicked!')}
      >
        <div style={{ padding: '40px', color: 'white', textAlign: 'center' }}>
          <h1 style={{ margin: 0 }}>Liquid Glass</h1>
          <p>This design is now standalone!</p>
        </div>
      </LiquidGlass>
    </div>
  )
}

export default App
