import { LayoutGrid, Film, List } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ViewMode = 'grid' | 'coverflow' | 'list';

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export const ViewModeSwitcher: React.FC<ViewModeSwitcherProps> = ({ value, onChange }) => (
  <ToggleGroup
    type="single"
    value={value}
    onValueChange={(v) => { if (v) onChange(v as ViewMode); }}
  >
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem value="grid" aria-label="Grid view" className="h-8 w-8 p-0">
          <LayoutGrid className="h-4 w-4" />
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>Grid</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem value="coverflow" aria-label="Cover Flow view" className="h-8 w-8 p-0">
          <Film className="h-4 w-4" />
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>Cover Flow</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem value="list" aria-label="List view" className="h-8 w-8 p-0">
          <List className="h-4 w-4" />
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>List</TooltipContent>
    </Tooltip>
  </ToggleGroup>
);
