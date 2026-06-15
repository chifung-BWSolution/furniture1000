import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, ChevronDown, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
  sort_order: number;
}

interface CascadingCategorySelectorProps {
  categories: Category[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  showClear?: boolean;
  triggerClassName?: string;
  /** Which side the level-2 submenu appears relative to level-1. Default is 'right'. */
  submenuSide?: 'left' | 'right';
}

export function CascadingCategorySelector({
  categories,
  value,
  onValueChange,
  placeholder = '選擇類目',
  showClear = false,
  triggerClassName,
  submenuSide = 'right',
}: CascadingCategorySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredLevel1, setHoveredLevel1] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build level-1 and level-2 categories
  const level1Categories = useMemo(
    () =>
      categories
        .filter((c) => c.level === 1)
        .sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  );

  const level2Map = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const cat of categories.filter((c) => c.level === 2)) {
      const list = map.get(cat.parent_id || '') || [];
      list.push(cat);
      map.set(cat.parent_id || '', list);
    }
    // Sort each group
    for (const [key, list] of map.entries()) {
      map.set(
        key,
        list.sort((a, b) => a.sort_order - b.sort_order)
      );
    }
    return map;
  }, [categories]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHoveredLevel1(null);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Handle level-1 hover with debounce
  const handleLevel1Enter = (catId: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredLevel1(catId);
    }, 100);
  };

  const handleLevel1Leave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  };

  // Handle level-1 click - if no children, select directly
  const handleLevel1Click = (cat: Category) => {
    const children = level2Map.get(cat.id);
    if (!children || children.length === 0) {
      // No subcategories, select the level-1 category directly
      onValueChange(cat.name);
      setIsOpen(false);
      setHoveredLevel1(null);
    } else {
      // Has subcategories, show them (for click on mobile or non-hover devices)
      setHoveredLevel1(cat.id);
    }
  };

  // Handle level-2 click
  const handleLevel2Click = (cat: Category) => {
    onValueChange(cat.name);
    setIsOpen(false);
    setHoveredLevel1(null);
  };

  // Handle clear
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange('__clear__');
    setIsOpen(false);
  };

  // Get currently hovered level-1's children
  const hoveredChildren = hoveredLevel1 ? level2Map.get(hoveredLevel1) || [] : [];

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-between gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background',
          'hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'transition-colors duration-150',
          triggerClassName || 'w-[160px] h-8'
        )}
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-0.5">
          {showClear && value && (
            <X
              className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={handleClear}
            />
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute top-full z-[100] mt-1 flex",
              submenuSide === 'left' ? 'right-0 flex-row-reverse' : 'left-0 flex-row'
            )}
          >
            {/* Level 1 panel */}
            <div className="min-w-[160px] max-h-[280px] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
              {showClear && (
                <button
                  type="button"
                  onClick={() => { onValueChange('__clear__'); setIsOpen(false); }}
                  className="w-full flex items-center px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded-sm transition-colors"
                >
                  清除分類
                </button>
              )}
              {level1Categories.map((cat) => {
                const hasChildren = (level2Map.get(cat.id) || []).length > 0;
                const isHovered = hoveredLevel1 === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={cn(
                      'w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-sm transition-colors',
                      isHovered ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    )}
                    onMouseEnter={() => handleLevel1Enter(cat.id)}
                    onMouseLeave={handleLevel1Leave}
                    onClick={() => handleLevel1Click(cat)}
                  >
                    <span className="truncate">{cat.name}</span>
                    {hasChildren && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    )}
                  </button>
                );
              })}
              {level1Categories.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                  暫無類目
                </div>
              )}
            </div>

            {/* Level 2 panel (shown on hover of level 1) */}
            <AnimatePresence>
              {hoveredChildren.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, x: submenuSide === 'left' ? 8 : -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: submenuSide === 'left' ? 8 : -8 }}
                  transition={{ duration: 0.12 }}
                  className={cn(
                    "min-w-[140px] max-h-[280px] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg",
                    submenuSide === 'left' ? 'mr-1' : 'ml-1'
                  )}
                  onMouseEnter={() => {
                    // Keep level-1 hovered
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  }}
                  onMouseLeave={() => {
                    setHoveredLevel1(null);
                  }}
                >
                  {hoveredChildren.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={cn(
                        'w-full flex items-center px-2 py-1.5 text-xs rounded-sm transition-colors',
                        value === cat.name
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-accent/50'
                      )}
                      onClick={() => handleLevel2Click(cat)}
                    >
                      <span className="truncate">{cat.name}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
