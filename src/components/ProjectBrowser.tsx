import React, { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { listProjects, deleteProjectCloud, downloadProjectBundleCloud } from '../lib/syncUtils';
import { X, FolderOpen, Clock, Music, Trash2, Cloud, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LiquidGlassPanel } from './LiquidGlass';
import { saveAsset, deleteLocalProjectState } from '../lib/assetManager';
import JSZip from 'jszip';

export function ProjectBrowser() {
  const { state, dispatch } = useApp();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [openStatus, setOpenStatus] = useState<string>('');
  const [openProgress, setOpenProgress] = useState<number>(0);

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
        // Delete cloud project
        await deleteProjectCloud(projectId);
        
        // Purge local project cache state
        await deleteLocalProjectState(projectId);

        // Remove active tracker if this was the last active project
        const lastActiveProjectId = localStorage.getItem('jaad_last_active_project_id');
        if (lastActiveProjectId === projectId) {
          localStorage.removeItem('jaad_last_active_project_id');
        }

        setProjects(projects.filter(p => p.id !== projectId));
      } catch (err) {
        console.error("Failed to delete project", err);
        alert("Failed to delete project.");
      }
    }
  };

  const handleOpenProject = async (project: any) => {
    if (project.hasBundle) {
      setOpeningProjectId(project.id);
      setOpenStatus('Downloading project bundle...');
      setOpenProgress(0);
      try {
        // Download ZIP bundle
        const blob = await downloadProjectBundleCloud(project.id, (progress) => {
          // We scale download progress between 0 and 70
          setOpenProgress(Math.max(0, Math.min(70, Math.round(progress * 0.7))));
        });

        setOpenStatus('Extracting assets...');
        setOpenProgress(75);

        const zip = await JSZip.loadAsync(blob);
        const projectJson = await zip.file("project.json")?.async("string");
        if (!projectJson) {
          throw new Error("Invalid .jaad file: project.json missing in cloud bundle");
        }

        const parsed = JSON.parse(projectJson);
        
        const assetsFolder = zip.folder("assets");
        if (assetsFolder) {
          const fileEntries: { relativePath: string; file: any }[] = [];
          assetsFolder.forEach((relativePath, file) => {
            if (relativePath.endsWith(".audio")) {
              fileEntries.push({ relativePath, file });
            }
          });

          const totalFiles = fileEntries.length;
          if (totalFiles > 0) {
            let processedFiles = 0;
            const promises = fileEntries.map(async ({ relativePath, file }) => {
              const id = relativePath.replace(".audio", "");
              const audioBlob = await file.async("blob");
              await saveAsset(id, audioBlob);
              processedFiles++;
              // Scale asset extraction progress between 75 and 98
              const extractProgress = 75 + Math.round((processedFiles / totalFiles) * 23);
              setOpenProgress(extractProgress);
            });
            await Promise.all(promises);
          }
        }

        setOpenProgress(100);
        setOpenStatus('Opening project...');
        // Small delay to show completion
        await new Promise(r => setTimeout(r, 600));

        dispatch({ type: 'SET_PROJECT_ID', payload: project.id });
        dispatch({ type: 'SYNC_STATE', payload: parsed });
        dispatch({ type: 'SET_HAS_MANUALLY_SAVED', payload: true });
        dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
        dispatch({ type: 'TOGGLE_PROJECT_BROWSER' });
      } catch (err: any) {
        console.error("Failed to open project bundle", err);
        alert(`Failed to load project: ${err.message || err}`);
      } finally {
        setOpeningProjectId(null);
        setOpenStatus('');
        setOpenProgress(0);
      }
    } else {
      // Legacy fallback: metadata only loading
      dispatch({ type: 'SET_PROJECT_ID', payload: project.id });
      dispatch({ type: 'SYNC_STATE', payload: project });
      dispatch({ type: 'SET_HAS_MANUALLY_SAVED', payload: false });
      dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
      dispatch({ type: 'TOGGLE_PROJECT_BROWSER' });
    }
  };

  return (
    <>
      <AnimatePresence>
        {state.isProjectBrowserOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
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
                className="w-full border border-white/5 shadow-2xl"
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
                          onClick={() => handleOpenProject(project)}
                          className="w-full text-left p-4 bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-primary/30 rounded-xl transition-all group flex items-center justify-between cursor-pointer backdrop-blur-sm"
                        >
                          <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                              <Music size={24} />
                            </div>
                            <div>
                              <h3 className="font-bold text-white group-hover:text-primary transition-colors flex items-center gap-2">
                                <span>{project.projectName || 'Untitled Project'}</span>
                                {project.hasBundle && (
                                  <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider bg-primary/20 border border-primary/30 text-primary rounded-md shadow-[0_0_8px_rgba(255,45,85,0.2)]">
                                    Bundle
                                  </span>
                                )}
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
        )}
      </AnimatePresence>

      {/* Cloud loading progress overlay */}
      <AnimatePresence>
        {openingProjectId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/60 backdrop-blur-md"
          >
            <div className="w-full max-w-md px-6">
              <LiquidGlassPanel
                cornerRadius={24}
                blurAmount={40}
                backgroundOpacity={0.2}
                className="shadow-2xl border border-white/10"
                contentClassName="p-8 flex flex-col items-center text-center space-y-6"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
                  <div className="relative bg-zinc-900/50 p-4 rounded-2xl border border-white/10">
                    <Cloud size={48} className="text-primary animate-bounce" />
                  </div>
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-bold tracking-tight text-white">Loading from Cloud</h2>
                  <p className="text-zinc-400 text-sm">{openStatus}</p>
                </div>

                <div className="w-full space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    <span>{openProgress < 75 ? 'Downloading' : 'Extracting Assets'}</span>
                    <span className="text-primary">{openProgress}%</span>
                  </div>

                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(255,45,85,0.4)]"
                      style={{ width: `${openProgress}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span>Please do not close this tab...</span>
                </div>
              </LiquidGlassPanel>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
