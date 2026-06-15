import { Check } from 'lucide-react';

/**
 * EvidenceStepper — horizontal step progress bar (Req 7.1–7.4).
 *
 * Props:
 *   steps       [{ id, title }]  — ordered list of steps
 *   currentStep  number           — 0-based index of the active step
 *   completedSteps Set<number>    — indices of completed steps
 *   onStepClick  (idx) => void    — called when a completed step is clicked (Req 7.5)
 */
export default function EvidenceStepper({ steps = [], currentStep = 0, completedSteps = new Set(), onStepClick }) {
  const n = steps.length;
  if (n === 0) return null;

  return (
    <nav aria-label="Evidence steps" className="w-full">
      <ol className="flex items-center w-full">
        {steps.map((step, idx) => {
          const isCompleted = completedSteps.has(idx);
          const isCurrent = idx === currentStep;
          const isUpcoming = !isCompleted && !isCurrent;
          const isLast = idx === n - 1;
          const isClickable = isCompleted && typeof onStepClick === 'function';

          return (
            <li
              key={step.id || idx}
              className={`flex items-center ${isLast ? 'flex-none' : 'flex-1'}`}
            >
              {/* Step circle + label */}
              <button
                type="button"
                onClick={isClickable ? () => onStepClick(idx) : undefined}
                disabled={!isClickable}
                title={step.title}
                className={[
                  'flex flex-col items-center group focus:outline-none',
                  isClickable ? 'cursor-pointer' : 'cursor-default',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex items-center justify-center w-8 h-8 rounded-full border-2 text-xs font-bold transition-colors shrink-0',
                    isCompleted
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : isCurrent
                      ? 'bg-white border-blue-500 text-blue-600 ring-2 ring-blue-300'
                      : 'bg-white border-zinc-300 text-zinc-400',
                    isClickable ? 'group-hover:border-emerald-400' : '',
                  ].join(' ')}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : <span>{idx + 1}</span>}
                </span>
                <span
                  className={[
                    'mt-1 text-[10px] font-medium text-center leading-tight max-w-[5rem] hidden sm:block',
                    isCompleted ? 'text-emerald-600' : isCurrent ? 'text-blue-600' : 'text-zinc-400',
                  ].join(' ')}
                >
                  {step.title}
                </span>
              </button>

              {/* Connector line between steps */}
              {!isLast && (
                <div
                  className={[
                    'flex-1 h-0.5 mx-1 sm:mx-2 mt-[-1rem] sm:mt-[-1.25rem]',
                    isCompleted ? 'bg-emerald-400' : 'bg-zinc-200',
                  ].join(' ')}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
