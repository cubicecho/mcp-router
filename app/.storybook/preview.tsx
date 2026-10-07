import type { Preview } from '@storybook/react-vite';
import { installApiMock } from '../src/storybook/mock-api.ts';
import { withProviders } from '../src/storybook/providers.tsx';
import '../src/index.css';

// Under the test runner nothing fades or slides: a dialog or toast that is still fading in reads as
// not visible, which fails a story at random. In the Storybook UI the motion stays.
if (navigator.webdriver) {
  const style = document.createElement('style');
  style.textContent =
    '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }';
  document.head.append(style);
}

const preview: Preview = {
  parameters: {
    // An accessibility violation fails the story, the same as a failed assertion.
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
  decorators: [withProviders],
  beforeEach: ({ parameters }) => installApiMock(parameters.api),
};

export default preview;
