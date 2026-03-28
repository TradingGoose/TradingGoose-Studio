import Image from 'next/image'
import Link from 'next/link'
import {
  DiscordIcon,
  GithubIcon,
  LinkedInIcon,
  xIcon as XIcon,
} from '@/components/icons/icons'
import { Separator } from '@/components/ui/separator'

const blocks = [
  'Agent',
  'API',
  'Condition',
  'Evaluator',
  'Function',
  'Loop',
  'Parallel',
  'Response',
  'Router',
  'Starter',
  'Webhook',
  'Workflow',
]

const tools = [
  'Airtable',
  'ArXiv',
  'Browser Use',
  'Clay',
  'Confluence',
  'Discord',
  'ElevenLabs',
  'Exa',
  'File',
  'Firecrawl',
  'Generic Webhook',
  'GitHub',
  'Gmail',
  'Google Calendar',
  'Google Docs',
  'Google Drive',
  'Google Vault',
  'Google Search',
  'Google Sheets',
  'HuggingFace',
  'Hunter',
  'Image Generator',
  'Jina',
  'Jira',
  'Knowledge',
  'Linear',
  'LinkUp',
  'Mem0',
  'Memory',
  'Microsoft Excel',
  'Microsoft Planner',
  'Microsoft Teams',
  'Mistral Parse',
  'MySQL',
  'Notion',
  'OneDrive',
  'OpenAI',
  'Outlook',
  'Parallel AI',
  'Perplexity',
  'Pinecone',
  'PostgreSQL',
  'Qdrant',
  'Reddit',
  'S3',
  'Schedule',
  'Serper',
  'SharePoint',
  'Slack',
  'Stagehand',
  'Stagehand Agent',
  'Supabase',
  'Tavily',
  'Telegram',
  'Thinking',
  'Translate',
  'Twilio SMS',
  'Typeform',
  'Vision',
  'Wealthbox',
  'Webhook',
  'WhatsApp',
  'Wikipedia',
  'X',
  'YouTube',
  'Zep',
]

interface FooterProps {
  fullWidth?: boolean
}

export default function Footer({ fullWidth = false }: FooterProps) {
  return (
    <footer>
      <div className='mx-auto grid max-w-[90vw] gap-6 px-4 py-8 sm:grid-cols-2 sm:gap-8 sm:px-6 sm:py-16 md:py-24 lg:grid-cols-4'>
        {/* Logo, description, socials, and standalone links */}
        <div className='flex flex-col items-start gap-4 lg:col-span-1'>
          <Link href='/' aria-label='TradingGoose Studio home' className='flex items-center gap-3'>
            <Image
              src='/icon.svg'
              alt=''
              width={28}
              height={28}
              className='h-7 w-7'
              priority
              quality={100}
            />
            <span className='text-xl font-semibold'>TradingGoose Studio</span>
          </Link>
          <p className='text-muted-foreground text-balance'>
            Workspace layouts, charting with indicators, and a visual workflow editor for trading.
          </p>
          <div className='flex items-center gap-4'>
            <a
              href='https://discord.gg/Hr4UWYEcTT'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='Discord'
            >
              <DiscordIcon className='h-[20px] w-[20px]' aria-hidden='true' />
            </a>
            <a
              href='https://x.com/simdotai'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='X (Twitter)'
            >
              <XIcon className='h-[18px] w-[18px]' aria-hidden='true' />
            </a>
            <a
              href='https://www.linkedin.com/company/simstudioai/'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='LinkedIn'
            >
              <LinkedInIcon className='h-[18px] w-[18px]' aria-hidden='true' />
            </a>
            <a
              href='https://github.com/simstudioai/sim'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='GitHub'
            >
              <GithubIcon className='h-[20px] w-[20px]' aria-hidden='true' />
            </a>
          </div>
          <Separator className='!w-35' />
          <Link
            href='/blog'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Blog
          </Link>
          <Link
            href='/changelog'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Changelog
          </Link>
          <Link
            href='https://docs.sim.ai'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Docs
          </Link>
          <Link
            href='#pricing'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Pricing
          </Link>
          <Link
            href='https://form.typeform.com/to/jqCO12pF'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Enterprise
          </Link>
          <Link
            href='/careers'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Careers
          </Link>
          <Link
            href='/privacy'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Privacy Policy
          </Link>
          <Link
            href='/terms'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[14px] text-muted-foreground transition-colors hover:text-foreground'
          >
            Terms of Service
          </Link>
        </div>

        {/* Blocks */}
        <div className='hidden flex-col gap-5 sm:flex'>
          <div className='text-lg font-medium'>Blocks</div>
          <ul className='text-muted-foreground space-y-3'>
            {blocks.map((block) => (
              <li key={block}>
                <Link
                  href={`https://docs.sim.ai/blocks/${block.toLowerCase().replace(' ', '-')}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='hover:text-foreground transition-colors duration-300'
                >
                  {block}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Tools */}
        <div className='hidden flex-col gap-5 sm:flex'>
          <div className='text-lg font-medium'>Tools</div>
          <div className='flex gap-[80px]'>
            <ul className='text-muted-foreground space-y-3'>
              {tools.slice(0, Math.ceil(tools.length / 4)).map((tool) => (
                <li key={tool}>
                  <Link
                    href={`https://docs.sim.ai/tools/${tool.toLowerCase().replace(/\s+/g, '_')}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='whitespace-nowrap hover:text-foreground transition-colors duration-300'
                  >
                    {tool}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className='text-muted-foreground space-y-3'>
              {tools
                .slice(Math.ceil(tools.length / 4), Math.ceil((tools.length * 2) / 4))
                .map((tool) => (
                  <li key={tool}>
                    <Link
                      href={`https://docs.sim.ai/tools/${tool.toLowerCase().replace(/\s+/g, '_')}`}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='whitespace-nowrap hover:text-foreground transition-colors duration-300'
                    >
                      {tool}
                    </Link>
                  </li>
                ))}
            </ul>
            <ul className='text-muted-foreground space-y-3'>
              {tools
                .slice(Math.ceil((tools.length * 2) / 4), Math.ceil((tools.length * 3) / 4))
                .map((tool) => (
                  <li key={tool}>
                    <Link
                      href={`https://docs.sim.ai/tools/${tool.toLowerCase().replace(/\s+/g, '_')}`}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='whitespace-nowrap hover:text-foreground transition-colors duration-300'
                    >
                      {tool}
                    </Link>
                  </li>
                ))}
            </ul>
            <ul className='text-muted-foreground space-y-3'>
              {tools.slice(Math.ceil((tools.length * 3) / 4)).map((tool) => (
                <li key={tool}>
                  <Link
                    href={`https://docs.sim.ai/tools/${tool.toLowerCase().replace(/\s+/g, '_')}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='whitespace-nowrap hover:text-foreground transition-colors duration-300'
                  >
                    {tool}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Separator />

      <div className='mx-auto flex max-w-7xl justify-center px-4 py-6 sm:px-6'>
        <p className='text-center font-medium text-balance'>
          {`©${new Date().getFullYear()} `}
          <Link href='/' className='hover:text-foreground transition-colors duration-300'>
            TradingGoose Studio
          </Link>
        </p>
      </div>
    </footer>
  )
}
