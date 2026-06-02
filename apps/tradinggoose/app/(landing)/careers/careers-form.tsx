'use client'

import { useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { quickValidateEmail } from '@/lib/email/validation'
import { cn } from '@/lib/utils'
import { soehne } from '@/app/fonts/soehne/soehne'
import { useAppMessages } from '@/i18n/client-messages'
import { type LocaleCode } from '@/i18n/utils'

const validateName = (name: string, message: string): string[] => {
  const errors: string[] = []
  if (!name || name.trim().length < 2) {
    errors.push(message)
  }
  return errors
}

const validateEmail = (email: string, requiredMessage: string, invalidMessage: string): string[] => {
  const errors: string[] = []
  if (!email || !email.trim()) {
    errors.push(requiredMessage)
    return errors
  }
  const validation = quickValidateEmail(email.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || invalidMessage)
  }
  return errors
}

const validatePosition = (position: string, message: string): string[] => {
  const errors: string[] = []
  if (!position || position.trim().length < 2) {
    errors.push(message)
  }
  return errors
}

const validateLinkedIn = (url: string, message: string): string[] => {
  if (!url || url.trim() === '') return []
  const errors: string[] = []
  try {
    new URL(url)
  } catch {
    errors.push(message)
  }
  return errors
}

const validatePortfolio = (url: string, message: string): string[] => {
  if (!url || url.trim() === '') return []
  const errors: string[] = []
  try {
    new URL(url)
  } catch {
    errors.push(message)
  }
  return errors
}

const validateLocation = (location: string, message: string): string[] => {
  const errors: string[] = []
  if (!location || location.trim().length < 2) {
    errors.push(message)
  }
  return errors
}

const validateMessage = (message: string, validationMessage: string): string[] => {
  const errors: string[] = []
  if (!message || message.trim().length < 50) {
    errors.push(validationMessage)
  }
  return errors
}

export function CareersForm() {
  const locale = useLocale() as LocaleCode
  const copy = useAppMessages().careers.form
  const contactEmail = copy.helpers.contactEmail
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [showErrors, setShowErrors] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [position, setPosition] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [portfolio, setPortfolio] = useState('')
  const [experience, setExperience] = useState('')
  const [location, setLocation] = useState('')
  const [message, setMessage] = useState('')
  const [resume, setResume] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [nameErrors, setNameErrors] = useState<string[]>([])
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [positionErrors, setPositionErrors] = useState<string[]>([])
  const [linkedinErrors, setLinkedinErrors] = useState<string[]>([])
  const [portfolioErrors, setPortfolioErrors] = useState<string[]>([])
  const [experienceErrors, setExperienceErrors] = useState<string[]>([])
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [messageErrors, setMessageErrors] = useState<string[]>([])
  const [resumeErrors, setResumeErrors] = useState<string[]>([])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    setResume(file)
    if (file) {
      setResumeErrors([])
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setShowErrors(true)

    const nameErrs = validateName(name, copy.validation.nameTooShort)
    const emailErrs = validateEmail(
      email,
      copy.validation.emailRequired,
      copy.validation.emailInvalid
    )
    const positionErrs = validatePosition(position, copy.validation.positionRequired)
    const linkedinErrs = validateLinkedIn(linkedin, copy.validation.linkedinInvalid)
    const portfolioErrs = validatePortfolio(portfolio, copy.validation.portfolioInvalid)
    const experienceErrs = experience ? [] : [copy.validation.experienceRequired]
    const locationErrs = validateLocation(location, copy.validation.locationRequired)
    const messageErrs = validateMessage(message, copy.validation.messageRequired)
    const resumeErrs = resume ? [] : [copy.validation.resumeRequired]

    setNameErrors(nameErrs)
    setEmailErrors(emailErrs)
    setPositionErrors(positionErrs)
    setLinkedinErrors(linkedinErrs)
    setPortfolioErrors(portfolioErrs)
    setExperienceErrors(experienceErrs)
    setLocationErrors(locationErrs)
    setMessageErrors(messageErrs)
    setResumeErrors(resumeErrs)

    if (
      nameErrs.length > 0 ||
      emailErrs.length > 0 ||
      positionErrs.length > 0 ||
      linkedinErrs.length > 0 ||
      portfolioErrs.length > 0 ||
      experienceErrs.length > 0 ||
      locationErrs.length > 0 ||
      messageErrs.length > 0 ||
      resumeErrs.length > 0
    ) {
      return
    }

    setIsSubmitting(true)
    setSubmitStatus('idle')

    try {
      const formData = new FormData()
      formData.append('name', name)
      formData.append('email', email)
      formData.append('phone', phone || '')
      formData.append('position', position)
      formData.append('linkedin', linkedin || '')
      formData.append('portfolio', portfolio || '')
      formData.append('experience', experience)
      formData.append('location', location)
      formData.append('message', message)
      formData.append('locale', locale)
      if (resume) formData.append('resume', resume)

      const response = await fetch('/api/careers/submit', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(copy.errors.submitFailed)
      }

      setSubmitStatus('success')
    } catch (error) {
      console.error('Error submitting application:', error)
      setSubmitStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={`${soehne.className} mx-auto max-w-2xl`}>
      <section className='rounded-2xl border border-border bg-muted/50 p-6 shadow-sm sm:p-10'>
        <h2 className='mb-2 font-medium text-2xl sm:text-3xl'>{copy.title}</h2>
        <p className='mb-8 text-gray-600 text-sm sm:text-base'>{copy.description}</p>

        <form onSubmit={onSubmit} className='space-y-5'>
          <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='name' className='font-medium text-sm'>
                {copy.fields.name.label}
              </Label>
              <Input
                id='name'
                placeholder={copy.fields.name.placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(
                  showErrors &&
                    nameErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {showErrors && nameErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {nameErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='email' className='font-medium text-sm'>
                {copy.fields.email.label}
              </Label>
              <Input
                id='email'
                type='email'
                placeholder={copy.fields.email.placeholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn(
                  showErrors &&
                    emailErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {showErrors && emailErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {emailErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='phone' className='font-medium text-sm'>
                {copy.fields.phone.label}
              </Label>
              <Input
                id='phone'
                type='tel'
                placeholder={copy.fields.phone.placeholder}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='position' className='font-medium text-sm'>
                {copy.fields.position.label}
              </Label>
              <Input
                id='position'
                placeholder={copy.fields.position.placeholder}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className={cn(
                  showErrors &&
                    positionErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {showErrors && positionErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {positionErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='linkedin' className='font-medium text-sm'>
                {copy.fields.linkedin.label}
              </Label>
              <Input
                id='linkedin'
                placeholder={copy.fields.linkedin.placeholder}
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                className={cn(
                  showErrors &&
                    linkedinErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {showErrors && linkedinErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {linkedinErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='portfolio' className='font-medium text-sm'>
                {copy.fields.portfolio.label}
              </Label>
              <Input
                id='portfolio'
                placeholder={copy.fields.portfolio.placeholder}
                value={portfolio}
                onChange={(e) => setPortfolio(e.target.value)}
                className={cn(
                  showErrors &&
                    portfolioErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {showErrors && portfolioErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {portfolioErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='experience' className='font-medium text-sm'>
                {copy.fields.experience.label}
              </Label>
              <Select value={experience} onValueChange={setExperience}>
                <SelectTrigger
                  className={cn(
                    showErrors &&
                      experienceErrors.length > 0 &&
                      'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                  )}
                >
                  <SelectValue placeholder={copy.fields.experience.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='0-1'>{copy.fields.experience.options[0]}</SelectItem>
                  <SelectItem value='1-3'>{copy.fields.experience.options[1]}</SelectItem>
                  <SelectItem value='3-5'>{copy.fields.experience.options[2]}</SelectItem>
                  <SelectItem value='5-10'>{copy.fields.experience.options[3]}</SelectItem>
                  <SelectItem value='10+'>{copy.fields.experience.options[4]}</SelectItem>
                </SelectContent>
              </Select>
              {showErrors && experienceErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {experienceErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='location' className='font-medium text-sm'>
                {copy.fields.location.label}
              </Label>
              <Input
                id='location'
                placeholder={copy.fields.location.placeholder}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={cn(
                  showErrors &&
                    locationErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {showErrors && locationErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {locationErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='message' className='font-medium text-sm'>
              {copy.fields.message.label}
            </Label>
            <Textarea
              id='message'
              placeholder={copy.fields.message.placeholder}
              className={cn(
                'min-h-[140px]',
                showErrors &&
                  messageErrors.length > 0 &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className='mt-1.5 text-gray-500 text-xs'>{copy.helpers.messageMinimum}</p>
            {showErrors && messageErrors.length > 0 && (
              <div className='mt-1 space-y-1 text-red-400 text-xs'>
                {messageErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
              </div>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='resume' className='font-medium text-sm'>
              {copy.fields.resume.label}
            </Label>
            <div className='relative'>
              {resume ? (
                <div className='flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2'>
                  <span className='flex-1 truncate text-sm'>{resume.name}</span>
                  <button
                    type='button'
                    onClick={(e) => {
                      e.preventDefault()
                      setResume(null)
                      if (fileInputRef.current) {
                        fileInputRef.current.value = ''
                      }
                    }}
                    className='flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground'
                    aria-label={copy.actions.removeFile}
                  >
                    <X className='h-4 w-4' />
                  </button>
                </div>
              ) : (
                <Input
                  id='resume'
                  type='file'
                  accept='.pdf,.doc,.docx'
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  className={cn(
                    showErrors &&
                      resumeErrors.length > 0 &&
                      'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                  )}
                />
              )}
            </div>
            <p className='mt-1.5 text-gray-500 text-xs'>{copy.fields.resume.helper}</p>
            {showErrors && resumeErrors.length > 0 && (
              <div className='mt-1 space-y-1 text-red-400 text-xs'>
                {resumeErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
              </div>
            )}
          </div>

          <div className='flex justify-end pt-2'>
            <Button
              type='submit'
              disabled={isSubmitting || submitStatus === 'success'}
              className='min-w-[200px] rounded-md border bg-primary text-black hover:bg-primary-hover disabled:opacity-50'
              size='lg'
            >
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {copy.actions.submitting}
                </>
              ) : submitStatus === 'success' ? (
                copy.actions.submitted
              ) : (
                copy.actions.submit
              )}
            </Button>
          </div>
        </form>
      </section>

      <section className='mt-6 text-center text-gray-600 text-sm'>
        <p>
          {copy.helpers.contactPrefix}{' '}
          <a
            href={`mailto:${contactEmail}`}
            className='font-medium underline transition-colors'
          >
            {contactEmail}
          </a>
        </p>
      </section>
    </div>
  )
}
