# Liquid Glass React Standalone

This is a standalone extraction of Apple's Liquid Glass effect for React.

## 📦 What's Included
- **Core Library**: Located in `src/` (TypeScript + React).
- **Shader Utils**: Custom shader-based displacement generator.
- **Built-in Assets**: Displacement maps are embedded as Base64 in `src/utils.ts`.

## 🚀 How to Use

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Build the Library**:
   ```bash
   npm run build
   ```

3. **Usage in your project**:
   ```tsx
   import LiquidGlass from './path-to-this-folder/src/index';

   function App() {
     return (
       <LiquidGlass displacementScale={70} blurAmount={0.1}>
         <div style={{ padding: '20px' }}>
           <h1>Hello Liquid Glass!</h1>
         </div>
       </LiquidGlass>
     );
   }
   ```

## ✨ Features
- Refraction modes: `standard`, `polar`, `prominent`, `shader`.
- Configurable elasticity, blur, and chromatic aberration.
- Cross-platform support (best in Chromium).
