// @vitest-environment jsdom
//
// W0-J4 — component-level accessibility gate for the vendored shadcn/ui
// primitives (03 §12.7 "Component a11y", table row 1: "any violation at
// `serious` or above" fails).
//
// Substitution note: 03 §12.7 and TASKS.md both name `jest-axe`, but this
// repo's configured test runner is Vitest, not Jest (CLAUDE.md §5 — "Tests
// are Vitest"), and `jest-axe` ships a Jest-specific `toHaveNoViolations`
// matcher wired to Jest's `expect`. We use `vitest-axe`, the same axe-core
// engine with a matcher built for Vitest's `expect`, giving the identical
// guarantee (axe-core's rule engine, same violation objects, same
// `impact` field) under the runner this repo actually uses.
//
// Each primitive is rendered in a minimal, realistic composition (the
// composite parts a real screen would use it with — e.g. Select needs its
// Trigger/Content/Item, Dialog needs Trigger/Content/Title/Description) and
// checked with axe-core. We assert zero violations at `serious` or
// `critical` impact, matching the gate's own threshold rather than a blanket
// zero-violations bar (a `minor`/`moderate` finding is a backlog item, not a
// gate failure, per 03 §12.7's own wording).
import { render } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion'
import { Badge } from './badge'
import { Button } from './button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'
import { Checkbox } from './checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from './drawer'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form'
import { useForm } from 'react-hook-form'
import { Input } from './input'
import { Label } from './label'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { ScrollArea } from './scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Separator } from './separator'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './sheet'
import { Skeleton } from './skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Textarea } from './textarea'
import { Toaster } from './sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

// axe-core reports every violation impact; the gate is "serious or above"
// (03 §12.7), so filter rather than assert a blanket empty array.
function seriousOrAbove(violations: { impact?: string | null }[]) {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

async function expectNoSeriousViolations(container: Element) {
  const results = await axe(container)
  expect(seriousOrAbove(results.violations)).toEqual([])
}

describe('ui primitives — accessibility (serious+)', () => {
  it('button', async () => {
    const { container } = render(<Button>Propose change</Button>)
    await expectNoSeriousViolations(container)
  })

  it('badge', async () => {
    const { container } = render(<Badge>Beta</Badge>)
    await expectNoSeriousViolations(container)
  })

  it('card', async () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Plan review</CardTitle>
          <CardDescription>Creates an OPEN PAYABLE in JD Edwards.</CardDescription>
        </CardHeader>
        <CardContent>Details</CardContent>
        <CardFooter>
          <Button>Confirm</Button>
        </CardFooter>
      </Card>,
    )
    await expectNoSeriousViolations(container)
  })

  it('separator', async () => {
    const { container } = render(
      <div>
        <span>Above</span>
        <Separator />
        <span>Below</span>
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('skeleton', async () => {
    // `aria-label` on a bare, roleless <div> is itself an axe violation
    // (aria-prohibited-attr) — the caller must give the placeholder a role
    // before naming it, which is the realistic composition: a loading
    // region, not a labelled div.
    const { container } = render(
      <div role="status" aria-label="Loading">
        <Skeleton className="h-4 w-32" />
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('checkbox with label', async () => {
    const { container } = render(
      <div className="flex items-center gap-2">
        <Checkbox id="ack" />
        <Label htmlFor="ack">I acknowledge this is irreversible</Label>
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('input with label', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="amount">Amount</Label>
        <Input id="amount" name="amount" />
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('textarea with label', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="reason">Reason</Label>
        <Textarea id="reason" name="reason" />
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('tabs', async () => {
    const { container } = render(
      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="effects">Effects</TabsTrigger>
        </TabsList>
        <TabsContent value="plan">Plan content</TabsContent>
        <TabsContent value="effects">Effects content</TabsContent>
      </Tabs>,
    )
    await expectNoSeriousViolations(container)
  })

  it('table', async () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>ebs.p2p.invoice.create</TableCell>
            <TableCell>active</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    await expectNoSeriousViolations(container)
  })

  it('accordion', async () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>Guardrails passed</AccordionTrigger>
          <AccordionContent>All three checks passed.</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    await expectNoSeriousViolations(container)
  })

  it('scroll-area', async () => {
    const { container } = render(
      <ScrollArea className="h-24 w-48">
        <p>Scrollable audit detail text.</p>
      </ScrollArea>,
    )
    await expectNoSeriousViolations(container)
  })

  it('select', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="env-select">Environment</Label>
        <Select>
          <SelectTrigger id="env-select">
            <SelectValue placeholder="Choose an environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dev">dev</SelectItem>
            <SelectItem value="prod">prod</SelectItem>
          </SelectContent>
        </Select>
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('popover', async () => {
    const { container } = render(
      <Popover open>
        <PopoverTrigger asChild>
          <Button>Filters</Button>
        </PopoverTrigger>
        <PopoverContent>Facet controls</PopoverContent>
      </Popover>,
    )
    await expectNoSeriousViolations(container)
  })

  it('tooltip', async () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button aria-label="Catalog">Catalog</Button>
          </TooltipTrigger>
          <TooltipContent>Catalog</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    await expectNoSeriousViolations(container)
  })

  it('dialog', async () => {
    const { container } = render(
      <Dialog open>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    await expectNoSeriousViolations(container)
  })

  it('sheet', async () => {
    const { container } = render(
      <Sheet open>
        <SheetTrigger asChild>
          <Button>Open</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Tool detail</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    await expectNoSeriousViolations(container)
  })

  it('drawer', async () => {
    const { container } = render(
      <Drawer open>
        <DrawerTrigger asChild>
          <Button>Open</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Change tray</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    )
    await expectNoSeriousViolations(container)
  })

  it('command', async () => {
    const { container } = render(
      <Command label="Command palette">
        <CommandInput placeholder="Search tools..." />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Tools">
            <CommandItem>ebs.p2p.invoice.create</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    await expectNoSeriousViolations(container)
  })

  it('form (react-hook-form field)', async () => {
    function Harness() {
      const form = useForm({ defaultValues: { amount: '' } })
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      )
    }
    const { container } = render(<Harness />)
    await expectNoSeriousViolations(container)
  })

  it('sonner Toaster mounts with no violations', async () => {
    const { container } = render(<Toaster />)
    await expectNoSeriousViolations(container)
  })
})
