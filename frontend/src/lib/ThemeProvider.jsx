import { useDarkMode } from '../hooks/useDarkMode';

export const ThemeProvider = ({ children }) => {
  // useDarkMode hook handles all the logic and DOM updates
  useDarkMode();
  
  return <>{children}</>;
};
