import React, { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { listProjects, deleteProjectCloud } from '../lib/syncUtils';
import { X, FolderOpen, Clock, Music, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LiquidGlassPanel } from './LiquidGlass';

export function ProjectBrowser() {
  const { state, dispatch } = useApp();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (state.isProjectBrowserOpen) {
      setLoading(true);
      listProjects()
        .then(data => {
          // Sort by last updated descending
          const sorted = data.sort((a: any, b: any) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
          setProjects(sorted);
          setLoading(false);
        })
        .catch(err => {
          console.error("Failed to load projects", err);
          setLoading(false);
        });
    }
  }, [state.isProjectBrowserOpen]);

  const handleDelete = async (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${projectName || 'Untitled'}"? This cannot be undone.`)) {
      try {
        await deleteProjectCloud(projectId);
        setProjects(projects.filter(p => p.id !== projectId));
      } catch (err) {
        console.error("Failed to delete project", err);
        alert("Failed to delete project.");
      }
    }
  };

  if (!state.isProjectBrowserOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      >
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="w-full max-w-2xl"
        >
          <LiquidGlassPanel
            cornerRadius={24}
            blurAmount={20}
            saturation={180}
            backgroundOpacity={0.10}
            className="w-full"
          >
            <div className="flex flex-col max-h-[80vh] overflow-hidden rounded-[24px]">
              {/* Header */}
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.03]">
                <div className="flex items-center space-x-3">
                  <FolderOpen className="text-primary" size={24} />
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-white/90">Cloud Project Browser</h2>
                    <p className="text-zinc-500 text-xs">Select a project to load from your Firebase storage</p>
                  </div>
                </div>
                <button 
                  onClick={() => dispatch({ type: 'TOGGLE_PROJECT_BROWSER' })}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-zinc-400 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar min-h-[300px]">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-4">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-zinc-500 text-sm">Fetching projects from cloud...</p>
                  </div>
                ) : projects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-zinc-700">
                      <FolderOpen size={32} />
                    </div>
                    <div>
                      <p className="text-white font-medium">No projects found</p>
                      <p className="text-zinc-500 text-sm">Create and save a project to see it here.</p>
                    </div>
                  </div>
                ) : (
                  projects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => {
                        dispatch({ type: 'SET_PROJECT_ID', payload: project.id });
                        dispatch({ type: 'SYNC_STATE', payload: project });
                        dispatch({ type: 'TOGGLE_PROJECT_BROWSER' });
                      }}
                      className="w-full text-left p-4 bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-primary/30 rounded-xl transition-all group flex items-center justify-between cursor-pointer backdrop-blur-sm"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                          <Music size={24} />
                        </div>
                        <div>
                          <h3 className="font-bold text-white group-hover:text-primary transition-colors">
                            {project.projectName || 'Untitled Project'}
                          </h3>
                          <div className="flex items-center space-x-3 mt-1 text-xs text-zinc-500">
                            <span className="flex items-center space-x-1">
                              <Clock size={12} />
                              <span>{project.lastUpdated ? new Date(project.lastUpdated).toLocaleString() : 'Never'}</span>
                            </span>
                            <span>•</span>
                            <span>{project.tracks?.length || 0} Tracks</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={(e) => handleDelete(e, project.id, project.projectName)}
                          className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all z-10"
                          title="Delete Project"
                        >
                          <Trash2 size={18} />
                        </button>
                        <div className="px-4 py-2 bg-white/5 rounded-lg text-xs font-medium group-hover:bg-primary group-hover:text-black transition-all">
                          Open Project
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 bg-white/[0.03] border-t border-white/5 text-center">
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Powered by Firebase Cloud Sync</p>
              </div>
            </div>
          </LiquidGlassPanel>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
