import type { LibraryStatus } from '@libra/shared/library';

export const statusLabels: Record<LibraryStatus, string> = {
  planned: 'Planned', in_progress: 'In progress', completed: 'Completed', on_hold: 'On hold', dropped: 'Dropped',
};
