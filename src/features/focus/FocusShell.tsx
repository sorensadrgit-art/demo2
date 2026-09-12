import FocusPatientSelect from './FocusPatientSelect';
import FocusAssessmentSelect from './FocusAssessmentSelect';
import FocusTreatment from './FocusTreatment';
import FocusResult from './FocusResult';
import { useFocusAutomation } from './useFocusAutomation';
import { useFocus } from './focusStore';

/** Focus Mode: Patient → Test → Perform → Review. Advanced tools stay one tap away. */
export default function FocusShell() {
  const phase = useFocus((s) => s.phase);
  useFocusAutomation();

  if (phase === 'patient') return <FocusPatientSelect />;
  if (phase === 'assessment') return <FocusAssessmentSelect />;
  if (phase === 'assessment-complete' || phase === 'review') return <FocusResult />;
  // setup/positioning/calibrating/acquiring/ready/recording/validating/
  // trial-complete/ready-next/error all render the treatment screen.
  return <FocusTreatment />;
}
