import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { HeaderBar } from '../components/HeaderBar';

describe('AppLayout 3-Pane UI', () => {
  it('renders HeaderBar with title and model selection trigger', () => {
    render(<HeaderBar title="Pi Desktop" selectedModel="gpt-4o" onOpenSettings={() => {}} />);
    expect(screen.getByText('Pi Desktop')).toBeDefined();
    expect(screen.getByText('gpt-4o')).toBeDefined();
  });
});
