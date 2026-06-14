const GRADE_STYLES = {
  A: 'bg-emerald-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-orange-500 text-white',
  D: 'bg-red-500 text-white',
};

const LANE_LABEL = {
  'like-new': 'Like New',
  good: 'Good',
  fair: 'Fair',
};

/**
 * Compact grade chip. `size` controls dimensions: 'sm' | 'md' | 'lg'.
 */
export default function GradeBadge({ grade, conditionLane, size = 'md', showLane = true }) {
  const dim = size === 'lg' ? 'w-14 h-14 text-3xl' : size === 'sm' ? 'w-7 h-7 text-sm' : 'w-10 h-10 text-xl';
  return (
    <div className="flex items-center gap-2">
      <div className={`${dim} rounded-xl flex items-center justify-center font-black ${GRADE_STYLES[grade] || 'bg-gray-400 text-white'}`}>
        {grade || '?'}
      </div>
      {showLane && conditionLane && (
        <span className="text-xs font-semibold text-gray-600">{LANE_LABEL[conditionLane] || conditionLane}</span>
      )}
    </div>
  );
}
