interface UserAvatarProps {
  name?: string | null;
  role?: string | null;
  size?: 'sm' | 'md' | 'lg';
  inactive?: boolean;
}

const SIZE_CLASSES = {
  sm: {
    box: 'w-9 h-9',
    face: 'w-5 h-5',
    hair: 'w-6 h-3',
    body: 'w-7 h-3',
    initial: 'text-[10px]',
  },
  md: {
    box: 'w-10 h-10',
    face: 'w-6 h-6',
    hair: 'w-7 h-3.5',
    body: 'w-8 h-3.5',
    initial: 'text-[11px]',
  },
  lg: {
    box: 'w-12 h-12',
    face: 'w-7 h-7',
    hair: 'w-8 h-4',
    body: 'w-9 h-4',
    initial: 'text-xs',
  },
};

function getInitial(name?: string | null) {
  return name?.trim().charAt(0).toUpperCase() || '?';
}

export default function UserAvatar({ name, role, size = 'md', inactive = false }: UserAvatarProps) {
  const classes = SIZE_CLASSES[size];
  const isAdmin = role === 'admin';

  return (
    <div
      className={`
        ${classes.box} rounded-full overflow-hidden relative flex-shrink-0
        ${inactive ? 'bg-gray-200' : isAdmin ? 'bg-amber-100' : 'bg-blue-100'}
      `}
      title={name || 'User'}
      aria-label={name || 'User'}
    >
      <div
        className={`
          absolute left-1/2 top-[16%] -translate-x-1/2 ${classes.hair}
          ${inactive ? 'bg-gray-500' : isAdmin ? 'bg-amber-700' : 'bg-slate-800'}
          rounded-t-full
        `}
      />
      <div
        className={`
          absolute left-1/2 top-[26%] -translate-x-1/2 ${classes.face}
          ${inactive ? 'bg-gray-300' : 'bg-orange-100'}
          rounded-full border border-white/70
        `}
      >
        <div className="absolute left-[27%] top-[38%] w-1 h-1 rounded-full bg-slate-800" />
        <div className="absolute right-[27%] top-[38%] w-1 h-1 rounded-full bg-slate-800" />
        <div className="absolute left-1/2 bottom-[22%] -translate-x-1/2 w-2.5 h-1 border-b border-slate-700 rounded-full" />
      </div>
      <div
        className={`
          absolute left-1/2 bottom-[-3%] -translate-x-1/2 ${classes.body}
          ${inactive ? 'bg-gray-400' : isAdmin ? 'bg-amber-500' : 'bg-blue-600'}
          rounded-t-full
        `}
      />
      <div
        className={`
          absolute right-0.5 bottom-0.5 w-4 h-4 rounded-full flex items-center justify-center
          ${inactive ? 'bg-gray-500 text-white' : isAdmin ? 'bg-yellow-500 text-yellow-950' : 'bg-white text-blue-700'}
          ${classes.initial} font-bold shadow-sm
        `}
      >
        {getInitial(name)}
      </div>
    </div>
  );
}
