import { render, screen } from '@testing-library/react';
import { StatusBadge, readableTextColor } from './status-badge';

describe('StatusBadge', () => {
  it('picks a readable text colour for any background', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#ffffff')).toBe('#000000');
    expect(readableTextColor('#f59e0b')).toBe('#000000'); // amber
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff'); // dark blue
    expect(readableTextColor('not-a-colour')).toBe('#000000');
  });

  it('shows the workflow state label in its colour', () => {
    render(<StatusBadge label="In production" color="#f59e0b" />);
    const badge = screen.getByText('In production');
    expect(badge).toHaveStyle({ backgroundColor: '#f59e0b', color: '#000000' });
  });
});
