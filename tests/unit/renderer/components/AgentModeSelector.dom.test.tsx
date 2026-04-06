import React from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';

function MockArcoButton({
  children,
  className,
  onClick,
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button className={className} onClick={onClick} style={style} type='button'>
      {children}
    </button>
  );
}

function MockArcoDropdown({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function MockArcoMenuRoot({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getMode: {
        invoke: vi.fn(),
      },
      setMode: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('@/renderer/utils/model/agentModes', () => ({
  getAgentModes: () => [{ value: 'default', label: 'Default' }],
  supportsModeSwitch: () => false,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
  }),
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: {
    primary: 'rgb(0, 0, 0)',
  },
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: () => null,
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(MockArcoMenuRoot, {
    ItemGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  });

  return {
    Button: MockArcoButton,
    Dropdown: MockArcoDropdown,
    Menu,
    Message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('@icon-park/react', () => ({
  Down: () => <span data-testid='agent-mode-selector-down' />,
  Robot: () => <span data-testid='agent-mode-selector-robot' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => options?.defaultValue ?? key,
  }),
}));

describe('AgentModeSelector trailing accessory visibility', () => {
  it('SC-054: reveals a hover-only trailing accessory when the pill receives keyboard focus', async () => {
    const user = userEvent.setup();

    render(
      <>
        <button data-testid='before-pill' type='button'>
          Before
        </button>
        <AgentModeSelector
          backend='codex'
          agentName='Codex'
          trailingAccessory={
            <button data-testid='diagnostics-button' type='button'>
              Diagnostics
            </button>
          }
          trailingAccessoryVisibility='hover'
        />
        <button data-testid='after-pill' type='button'>
          After
        </button>
      </>
    );

    const pill = screen.getByTestId('agent-mode-selector-pill');
    const accessory = screen.getByTestId('agent-mode-selector-trailing-accessory');

    expect(pill).toHaveAttribute('tabindex', '0');
    expect(accessory).toHaveAttribute('data-revealed', 'false');

    await user.tab();
    expect(screen.getByTestId('before-pill')).toHaveFocus();

    await user.tab();
    expect(pill).toHaveFocus();
    expect(accessory).toHaveAttribute('data-revealed', 'true');

    await user.tab();
    expect(screen.getByTestId('diagnostics-button')).toHaveFocus();
    expect(accessory).toHaveAttribute('data-revealed', 'true');

    await user.tab();
    expect(screen.getByTestId('after-pill')).toHaveFocus();
    expect(accessory).toHaveAttribute('data-revealed', 'false');
  });

  it('SC-054: reveals a hover-only trailing accessory while the pointer is over the pill', () => {
    render(
      <AgentModeSelector
        backend='codex'
        agentName='Codex'
        trailingAccessory={
          <button data-testid='diagnostics-button' type='button'>
            Diagnostics
          </button>
        }
        trailingAccessoryVisibility='hover'
      />
    );

    const pill = screen.getByTestId('agent-mode-selector-pill');
    const accessory = screen.getByTestId('agent-mode-selector-trailing-accessory');

    expect(accessory).toHaveAttribute('data-revealed', 'false');

    fireEvent.mouseEnter(pill);
    expect(accessory).toHaveAttribute('data-revealed', 'true');

    fireEvent.mouseLeave(pill);
    expect(accessory).toHaveAttribute('data-revealed', 'false');
  });
});
