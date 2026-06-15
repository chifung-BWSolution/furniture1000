import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { OFFICIAL_PRODUCT_TAGS } from '@/constants/product-tags';
import { X, ChevronDown, Search } from 'lucide-react';

interface TagSelectorProps {
  /** Currently selected tags */
  selectedTags: string[];
  /** Called when tags change */
  onChange: (tags: string[]) => void;
  /** Compact mode for table cells */
  compact?: boolean;
  /** Max tags visible before "+N" (compact mode) */
  maxVisible?: number;
  /** Class name override */
  className?: string;
}

export function TagSelector({
  selectedTags,
  onChange,
  compact = false,
  maxVisible = 3,
  className,
}: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({ top: 0, left: 0, width: 264, maxHeight: 250 });

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate dropdown position with collision detection
  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const dropdownMaxHeight = 250;
    const gap = 4;

    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    // Flip: if not enough space below but more space above, flip to top
    const shouldFlipUp = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow;

    // Dynamic max-height based on available viewport space
    const availableHeight = shouldFlipUp ? spaceAbove : spaceBelow;
    const computedMaxHeight = Math.min(dropdownMaxHeight, Math.max(100, availableHeight - 8));

    setDropdownPos({
      top: shouldFlipUp ? rect.top - computedMaxHeight - gap : rect.bottom + gap,
      left: rect.left,
      width: Math.max(264, rect.width),
      maxHeight: computedMaxHeight,
    });
  }, []);

  // Focus search when dropdown opens & calculate position
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen, updateDropdownPosition]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    const handleReposition = () => updateDropdownPosition();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isOpen, updateDropdownPosition]);

  const filteredTags = OFFICIAL_PRODUCT_TAGS.filter(tag =>
    tag.toLowerCase().includes(search.toLowerCase()) &&
    !selectedTags.includes(tag)
  );

  const removeTag = useCallback((tag: string) => {
    onChange(selectedTags.filter(t => t !== tag));
  }, [selectedTags, onChange]);

  const addTag = useCallback((tag: string) => {
    if (!selectedTags.includes(tag)) {
      onChange([...selectedTags, tag]);
    }
    setSearch('');
  }, [selectedTags, onChange]);

  const visibleTags = compact ? selectedTags.slice(0, maxVisible) : selectedTags;
  const hiddenCount = compact ? Math.max(0, selectedTags.length - maxVisible) : 0;

  // Portal-based dropdown menu
  const dropdown = isOpen
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] rounded-lg border border-border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 duration-150"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            maxHeight: dropdownPos.maxHeight,
          }}
        >
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋標籤 Search tags..."
              className="flex-1 bg-transparent text-xs font-body outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Available tags */}
          <div className="overflow-y-auto p-1" style={{ maxHeight: dropdownPos.maxHeight - 44 }}>
            {filteredTags.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground font-body">
                {search ? '找不到標籤 No tags found' : '已選擇所有標籤 All tags selected'}
              </p>
            ) : (
              filteredTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="flex w-full items-center rounded-md px-3 py-1.5 text-left text-xs font-body transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {tag}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  // Compact mode: inline tags with trigger (for table cells)
  if (compact) {
    return (
      <div ref={containerRef} className={cn('relative', className)}>
        <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
          {visibleTags.map(tag => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-0.5 font-mono-data shrink-0 text-[9px] px-1.5 py-0.5 h-5"
            >
              <span className="truncate max-w-[100px]">{tag}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-2 w-2" />
              </button>
            </Badge>
          ))}

          {hiddenCount > 0 && (
            <span className="text-[9px] text-muted-foreground font-mono-data">
              +{hiddenCount}
            </span>
          )}

          {/* Dropdown trigger */}
          <button
            ref={triggerRef}
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-0.5 rounded-md border border-dashed border-border transition-colors hover:border-primary hover:bg-primary/5 h-5 px-1.5 text-[9px]"
          >
            <span className="text-muted-foreground">+</span>
            <ChevronDown className={cn(
              'text-muted-foreground transition-transform h-2 w-2',
              isOpen && 'rotate-180'
            )} />
          </button>
        </div>

        {dropdown}
      </div>
    );
  }

  // Full mode: Fixed-height trigger bar, tags displayed BELOW
  return (
    <div ref={containerRef} className={cn('flex flex-col gap-2', className)}>
      {/* Fixed-height dropdown trigger bar (always 40px) */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-border px-3 transition-colors hover:border-primary hover:bg-primary/5',
          isOpen && 'border-primary ring-1 ring-primary/20'
        )}
      >
        <span className="text-xs font-body text-muted-foreground">
          {selectedTags.length === 0
            ? '選擇標籤 Select tags...'
            : `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''} selected`}
        </span>
        <ChevronDown className={cn(
          'h-3.5 w-3.5 text-muted-foreground transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* Dropdown rendered via portal (floats above everything) */}
      {dropdown}

      {/* Selected tags displayed BELOW the trigger bar */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-2">
          {selectedTags.map(tag => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-0.5 font-mono-data shrink-0 text-[11px] px-2.5 py-1 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 cursor-pointer"
              onClick={() => removeTag(tag)}
            >
              <span className="truncate max-w-[100px]">{tag}</span>
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
