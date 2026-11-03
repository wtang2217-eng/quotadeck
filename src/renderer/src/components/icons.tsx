// Icons: one line set (lucide, ISC license) at a fixed 1.5 px stroke, 16 px by default, plus the QuotaDeck icon.
// The names stay the app's own so the pages do not depend on the icon library.

import type { ComponentType, SVGProps } from 'react'
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Bell,
  BookOpen,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleArrowUp,
  CircleQuestionMark,
  Clock,
  Command,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  GitMerge,
  Hand,
  House,
  Info,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Lock,
  LogIn,
  MessageSquare,
  Monitor,
  Moon,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Terminal,
  Trash,
  TriangleAlert,
  User,
  Users,
  Volume2,
  X,
  Zap,
  type LucideProps
} from 'lucide-react'
import logoUrl from '../assets/logo.png'

/** `stroke` is accepted for older call sites and ignored: every icon draws with the same 1.5 px line. */
type IconProps = { size?: number; stroke?: number } & Omit<SVGProps<SVGSVGElement>, 'stroke' | 'ref'>

function wrap(Icon: ComponentType<LucideProps>) {
  return function AppIcon({ size = 16, stroke: _stroke, ...rest }: IconProps) {
    return <Icon size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" {...(rest as LucideProps)} />
  }
}

export const IconGrid = wrap(LayoutDashboard)
export const IconLedger = wrap(ChartColumn)
export const IconChat = wrap(MessageSquare)
export const IconUsers = wrap(Users)
export const IconPulse = wrap(Activity)
export const IconSettings = wrap(Settings)
export const IconSliders = wrap(SlidersHorizontal)
export const IconShield = wrap(ShieldCheck)
export const IconTerminal = wrap(Terminal)
export const IconMonitor = wrap(Monitor)
export const IconPlus = wrap(Plus)
export const IconRefresh = wrap(RefreshCw)
export const IconMore = wrap(Ellipsis)
export const IconFolder = wrap(Folder)
export const IconCopy = wrap(Copy)
export const IconSearch = wrap(Search)
export const IconCheck = wrap(Check)
export const IconX = wrap(X)
export const IconAlert = wrap(TriangleAlert)
export const IconInfo = wrap(Info)
export const IconStar = wrap(Star)
export const IconArrowRight = wrap(ArrowRight)
export const IconArrowUpRight = wrap(ArrowUpRight)
export const IconExternal = wrap(ExternalLink)
export const IconTrash = wrap(Trash)
export const IconPencil = wrap(Pencil)
export const IconLogin = wrap(LogIn)
export const IconZap = wrap(Zap)
export const IconClock = wrap(Clock)
export const IconMerge = wrap(GitMerge)
export const IconPlug = wrap(Plug)
export const IconUser = wrap(User)
export const IconChevronDown = wrap(ChevronDown)
export const IconChevronRight = wrap(ChevronRight)
export const IconChevronsUpDown = wrap(ChevronsUpDown)
export const IconSparkle = wrap(Sparkles)
export const IconLock = wrap(Lock)
export const IconHome = wrap(House)
export const IconBan = wrap(Ban)
export const IconEye = wrap(Eye)
export const IconEyeOff = wrap(EyeOff)
export const IconHand = wrap(Hand)
export const IconVolume = wrap(Volume2)
export const IconPlay = wrap(Play)
export const IconBell = wrap(Bell)
export const IconSwitch = wrap(ArrowLeftRight)
export const IconDoc = wrap(FileText)
export const IconBook = wrap(BookOpen)
export const IconHelp = wrap(CircleQuestionMark)
export const IconUpdate = wrap(CircleArrowUp)
export const IconLightbulb = wrap(Lightbulb)
export const IconDownload = wrap(Download)
export const IconCommand = wrap(Command)
export const IconLayers = wrap(Layers)
export const IconSun = wrap(Sun)
export const IconMoon = wrap(Moon)

/** GitHub's mark is not in the line set; drawn here in the same 1.5 px line. */
export function IconGithub({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={(1.5 * 24) / size} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 19c-4 1.3-4-2-5.5-2.5M14.5 21v-3.2c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.3 3 5.3 3.3 5.3 3.3a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 9.8c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
    </svg>
  )
}

/** The QuotaDeck icon (the eclipse). */
export function Logo({ size = 34 }: { size?: number }) {
  return <img className="logo-img" src={logoUrl} width={size} height={size} alt="" draggable={false} />
}
